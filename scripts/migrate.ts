/**
 * Apply src/schema.sql. Idempotent — every statement is create-if-not-exists
 * or an additive alter, so running it against a live database is safe.
 *
 * Run:  DATABASE_URL=... npm run migrate
 */
import { migrate, pool } from "../src/db.js";

await migrate();
console.log("schema up to date");
await pool.end();
