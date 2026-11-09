# Contributing to Aero Dynamic

First off, thank you for considering contributing to Aero Dynamic! It's people like you that make Aero Dynamic such a great tool.

## Setting up your development environment

1. **Fork the repository** to your own GitHub account and then clone it to your local device.
2. **Install the dependencies:**
   ```bash
   npm install
   ```
3. **Configure your environment variables:**
   Copy the example environment file and fill in your values.
   ```bash
   cp .env.example .env
   ```
4. **Start the development server:**
   ```bash
   npm run dev
   ```

## Development Workflow

1. Create a branch for your feature or bugfix:
   `git checkout -b feature/your-feature-name` or `bugfix/issue-number-description`
2. Commit your changes. Ensure your commit messages are descriptive.
3. Push to your branch and submit a Pull Request to the `main` branch.

## Code Style

* We use **Prettier** for code formatting. Please ensure your code is formatted before submitting.
* We use **ESLint** for code quality. Run `npm run lint` to check for any issues.

## Submitting a Pull Request (PR)

1. Ensure your PR is linked to an existing issue. If there isn't one, please create an issue first.
2. Fill out the Pull Request Template provided when you open a PR.
3. Make sure all CI checks pass.
