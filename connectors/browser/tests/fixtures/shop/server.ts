import { createServer } from "node:http";
import { once } from "node:events";

/** Synthetic, offline shop. No real accounts, payments or site requests. */
export async function startShop() {
  let clicks = 0;
  const pages: Record<string, string> = {
    "/": `<h1>Restaurants</h1><form action="/search"><input type="search" aria-label="Search for restaurants"><button>Search</button></form>
      <a href="/menu">Test Kitchen</a><a href="/login">Login</a><a hidden href="/hidden">Invisible</a>
      <button style="position:absolute;top:20000px">Far away</button>`,
    "/menu": `<h1>Test Kitchen menu</h1><p>Dal rice ₹120</p><button type="button" onclick="this.textContent='Added'">ADD</button>
      <a href="/cart">Cart</a><select aria-label="Portion"><option>Regular</option><option value="large">Large</option></select>`,
    "/cart": `<h1>Your cart</h1><p>Total ₹120</p><button type="button" onclick="fetch('/commit', {method:'POST'}).then(()=>location.href='/payment')">Proceed to Pay</button>
      <form action="/commit" method="post"><input aria-label="Delivery note"><button>Continue</button></form>
      <button type="button">Confirm</button><button type="button">Book ride</button><button type="button">Delete</button>`,
    "/payment": `<h1>Payment</h1><p>Pay by card, UPI, netbanking or wallet</p><form>
      <input name="cardNumber" autocomplete="cc-number" aria-label="Card number" value="4111111111111111">
      <input name="cvv" autocomplete="cc-csc" placeholder="CVV"><input id="upiPin" placeholder="UPI PIN">
      <button type="button" onclick="fetch('/commit', {method:'POST'})">Pay now</button></form>`,
    "/login": `<h1>Sign in</h1><form><input type="password" aria-label="Password" value="synthetic-password">
      <input name="otp" autocomplete="one-time-code" placeholder="OTP" value="123456">
      <input aria-label="PIN"><input id="passwordField"><input placeholder="Card number">
      <select name="upiPin"><option>1234</option></select><button>Sign in</button></form>`,
    "/account": `<h1>My account</h1><button>Logout</button>`,
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/commit") {
      clicks++;
      response.end("OK");
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html><head><title>Fixture Shop</title></head><body>${pages[path] ?? "<h1>Search results</h1>"}</body></html>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    clicks: () => clicks,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
