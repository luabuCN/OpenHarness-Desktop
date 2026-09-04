import { prisma } from "./src/db.js";
const id = "e2e-skill-test-1";
const conv = await prisma.conversation.findUnique({ where: { id } });
if (conv) {
  await prisma.conversation.delete({ where: { id } });
  console.log("deleted test conversation", id);
} else {
  console.log("not found (already clean)");
}
await prisma.$disconnect();
