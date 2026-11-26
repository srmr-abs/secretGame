import { hashPassword } from '../server/src/utils/auth';

async function main() {
  const password = process.argv[2];
  if (!password || password.length < 12) {
    throw new Error('Provide an admin password of at least 12 characters as the first argument.');
  }
  console.log(await hashPassword(password));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
