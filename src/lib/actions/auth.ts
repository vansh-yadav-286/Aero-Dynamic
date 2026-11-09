'use server';

import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "@/lib/password";

const registrationSchema = z.object({
  name: z.string().trim().min(2, "Name must contain at least 2 characters.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(12, "Password must be at least 12 characters.").max(128),
});

export async function registerUser(formData: FormData) {
  const phoneValue = formData.get("phone");
  const parsed = registrationSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: typeof phoneValue === "string" && phoneValue.trim() ? phoneValue.trim() : undefined,
    password: formData.get("password"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || "Invalid registration details.");
  }

  const { name, email, phone, password } = parsed.data;

  // Public registration must never let a user grant themselves dispatcher
  // or director privileges. Directors can assign elevated roles separately.
  const role = Role.GROUND_CREW_LEAD;

  const existingUser = await db.users.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new Error("An account with this email address already exists.");
  }

  await db.users.create({
    data: {
      name,
      email,
      phone,
      password: await hashPassword(password),
      role,
    },
  });

  return { success: true };
}
