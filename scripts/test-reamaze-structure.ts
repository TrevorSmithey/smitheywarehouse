import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const brand = process.env.REAMAZE_BRAND;
  const email = process.env.REAMAZE_EMAIL;
  const apiToken = process.env.REAMAZE_API_TOKEN;

  const authHeader = "Basic " + Buffer.from(email + ":" + apiToken).toString("base64");

  // Fetch a single conversation to see full structure
  const res = await fetch(`https://${brand}.reamaze.com/api/v1/conversations?page=1`, {
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
    },
  });

  const data = await res.json();
  const conv = data.conversations[0];
  console.log("Full conversation structure:");
  console.log(JSON.stringify(conv, null, 2));
}

main();
