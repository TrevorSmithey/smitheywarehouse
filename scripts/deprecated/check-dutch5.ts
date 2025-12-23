import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchAllProducts, WAREHOUSES } from "../lib/shiphero";

async function checkDutch5() {
  const products = await fetchAllProducts();
  const dutch5 = products.find(p => p.sku === "Smith-CI-Dutch5");
  
  if (dutch5) {
    console.log("Smith-CI-Dutch5 from ShipHero:");
    console.log(JSON.stringify(dutch5, null, 2));
  } else {
    console.log("Smith-CI-Dutch5 not found");
    // Check for similar SKUs
    const similar = products.filter(p => p.sku.includes("Dutch5"));
    console.log("Similar SKUs:", similar.map(p => p.sku));
  }
}

checkDutch5();
