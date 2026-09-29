import { randomInt } from "node:crypto";

// Lowercase letters and digits with the look-alikes l, o, 0, 1 removed. See
// docs/adr/0001-ten-character-addresses.md.
export const ADDRESS_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const ADDRESS_LENGTH = 10;
export const ADDRESS_PATTERN = /^[a-km-np-z2-9]{10}$/;

export function generateAddress() {
  let address = "";
  for (let i = 0; i < ADDRESS_LENGTH; i += 1) {
    address += ADDRESS_ALPHABET[randomInt(0, ADDRESS_ALPHABET.length)];
  }
  return address;
}

const MAX_CLAIM_ATTEMPTS = 5;

export async function claimAddress(client, handoutId) {
  for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const value = generateAddress();
    try {
      await client.query(
        "insert into address (value, handout_id) values ($1, $2)",
        [value, handoutId],
      );
      return value;
    } catch (err) {
      if (err && err.code === "23505" && attempt < MAX_CLAIM_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Could not claim a unique address");
}

// The address's own existence, not "is there a live handout here". That is what
// loadProtection (src/protection.js) answers, through an inner join onto
// handout, and it goes null the moment a handout is deleted. Asked for the
// certificate question it would take the certificate away from every old link
// at its next renewal, and leave a browser TLS error where
// docs/adr/0023-one-answer-for-an-address-that-shows-nothing.md promises
// Handout's own page. The address row survives the handout by decision.
export async function addressExists(pool, value) {
  const result = await pool.query("select 1 from address where value = $1", [
    value,
  ]);
  return result.rowCount > 0;
}
