import { scout } from "../db";
import { Live } from "./live";

export const dynamic = "force-dynamic";

export default async function ScoutPage() {
  const data = await scout();
  return <Live initial={data} />;
}
