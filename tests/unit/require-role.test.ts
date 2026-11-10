import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockGetServerSession = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  const err: any = new Error(`NEXT_REDIRECT:${url}`);
  err.digest = `NEXT_REDIRECT;${url}`;
  throw err;
});

vi.mock('next-auth/next', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

describe('requireRole', () => {
  let requireRole: typeof import('../../src/lib/auth').requireRole;

  beforeEach(async () => {
    vi.resetModules();
    mockGetServerSession.mockReset();
    mockRedirect.mockClear();
    const authModule = await import('../../src/lib/auth');
    requireRole = authModule.requireRole;
  });

  test('authorized role succeeds and returns the session', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u1', email: 'dispatcher@test.com', name: 'Dispatcher', role: 'FLIGHT_DISPATCHER' },
    });

    const session = await requireRole(['FLIGHT_DISPATCHER', 'OPERATIONS_DIRECTOR'] as any);

    expect(session.user.role).toBe('FLIGHT_DISPATCHER');
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  test('unauthorized role is rejected', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u2', email: 'crew@test.com', name: 'Crew', role: 'GROUND_CREW_LEAD' },
    });

    await expect(requireRole(['OPERATIONS_DIRECTOR'] as any)).rejects.toThrow();
    expect(mockRedirect).toHaveBeenCalledWith('/unauthorized');
  });

  test('missing session is rejected', async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(requireRole(['OPERATIONS_DIRECTOR'] as any)).rejects.toThrow();
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  test('a session retrieval failure is treated as unauthenticated, never granted a default role', async () => {
    mockGetServerSession.mockRejectedValue(new Error('session store unavailable'));

    await expect(requireRole(['OPERATIONS_DIRECTOR'] as any)).rejects.toThrow();
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  test('empty allowed-role list grants no access even when authenticated', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u3', email: 'director@test.com', name: 'Director', role: 'OPERATIONS_DIRECTOR' },
    });

    await expect(requireRole([])).rejects.toThrow();
    expect(mockRedirect).toHaveBeenCalledWith('/unauthorized');
  });

  test('multiple allowed roles permit any matching role', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u4', email: 'lead@test.com', name: 'Lead', role: 'GROUND_CREW_LEAD' },
    });

    const session = await requireRole(['GROUND_CREW_LEAD', 'FLIGHT_DISPATCHER', 'OPERATIONS_DIRECTOR'] as any);
    expect(session.user.id).toBe('u4');
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  test('multiple allowed roles reject a role outside the list', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u5', email: 'lead@test.com', name: 'Lead', role: 'GROUND_CREW_LEAD' },
    });

    await expect(
      requireRole(['FLIGHT_DISPATCHER', 'OPERATIONS_DIRECTOR'] as any)
    ).rejects.toThrow();
    expect(mockRedirect).toHaveBeenCalledWith('/unauthorized');
  });
});
