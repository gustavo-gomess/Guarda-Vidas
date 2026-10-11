/**
 * Administrator bootstrap and recovery. Run on a machine with access to the
 * database (see docs/DEVELOPMENT.md, "Primeiro administrador").
 *
 *   npm run admin -- create --username <login> --name "<Nome>" [--role COORDINATOR|AUTHORITY]
 *   npm run admin -- reset-password --username <login>
 *
 * The password is generated here and printed once; it is never taken from
 * arguments (shell history) or written to logs. The user must change it at
 * the first sign-in.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { parseServerEnv } from "@/lib/env-schema";
import { createUserSchema, usernameSchema } from "@/features/users/schemas";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

function exit(message: string): never {
  console.error(`\nErro: ${message}\n`);
  process.exit(1);
}

function printPassword(username: string, password: string) {
  console.log(`
Usuário:          ${username}
Senha temporária: ${password}

Esta senha aparece só agora e não fica salva. Entregue-a pessoalmente e
limpe o terminal depois. Ela terá de ser trocada no primeiro acesso.
`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      username: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "COORDINATOR" },
    },
  });
  const command = positionals[0];
  if (command !== "create" && command !== "reset-password") {
    exit('use "create" ou "reset-password". Veja docs/DEVELOPMENT.md.');
  }

  const env = parseServerEnv(process.env);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    if (command === "create") {
      const parsed = createUserSchema.safeParse({
        username: values.username,
        name: values.name,
        role: values.role,
        isAdmin: "on",
      });
      if (!parsed.success) {
        exit(parsed.error.issues.map((issue) => issue.message).join(" "));
      }
      if (parsed.data.role === "LIFEGUARD") {
        exit("o administrador deve ter perfil COORDINATOR ou AUTHORITY.");
      }

      const activeAdmins = await db.user.count({
        where: { isAdmin: true, active: true },
      });
      if (activeAdmins > 0) {
        exit(
          "já existe administrador ativo. Crie novos usuários pela interface (Usuários).",
        );
      }

      const password = generateTemporaryPassword();
      const passwordHash = await hashPassword(password);
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { ...parsed.data, passwordHash, mustChangePassword: true },
        });
        await recordAudit(tx, {
          actorId: null,
          action: "user.create",
          entityType: "User",
          entityId: user.id,
          after: {
            username: user.username,
            name: user.name,
            role: user.role,
            isAdmin: true,
            active: true,
            via: "linha de comando",
          },
        });
      });
      printPassword(parsed.data.username, password);
      return;
    }

    // reset-password: recovery for administrators only. Other users are
    // reset by an administrator in the interface.
    const username = usernameSchema.safeParse(values.username);
    if (!username.success) exit("informe --username.");
    const user = await db.user.findUnique({
      where: { username: username.data },
      select: { id: true, isAdmin: true, active: true },
    });
    if (!user || !user.isAdmin || !user.active) {
      exit("administrador ativo não encontrado com esse usuário.");
    }

    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await recordAudit(tx, {
        actorId: null,
        action: "user.password_reset",
        entityType: "User",
        entityId: user.id,
        after: { mustChangePassword: true, via: "linha de comando" },
      });
    });
    printPassword(username.data, password);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Only the message: the error object may include connection details.
  exit(error instanceof Error ? error.message : String(error));
});
