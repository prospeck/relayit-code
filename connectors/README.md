# India services

Enable these optional local stdio MCP servers in the MCP servers panel. They ship
through `server/india-connectors.ts`; the server bundler includes that entry. No
separate Node install or connector package installation is needed in the desktop
build. Existing MCP testing, switches, bot access and approval rules apply.

- Food: Bengaluru demo catalogue, restaurant aliases, menus, quotes and persistent
  mock orders. ONDC is an interface stub and performs no network calls.
- Travel: demo railway stations, timetables and fares, Namma Metro routes, IRCTC
  and Uber handoff links. No real booking or live availability.
- Payments: UPI URI/QR handoff, persistent requests, and a loopback mock checkout
  by default. Optional Razorpay keys accept test mode only. Keys use the app's
  encrypted LoginStore; config contains only a credential reference. Enter keys
  through the dedicated settings form, never MCP environment config or chat.

The person pays in their own app. A UPI user assertion stays `user_confirmed`,
not bank-verified, and cannot confirm an order. Only a settled test checkout
matching the stored demo order's amount and payee advances that mock order.
Demo order cards hide the payable QR and show the mock checkout instead. Never
pay a demo merchant with real money. Pending loopback mock checkout links belong
to the running connector process; settled requests survive a restart.

MCP standard annotations distinguish reads from mutations. Money names retain
the app's mandatory outbound approval. The food payment-confirmation helper is
not exposed as a public tool. These tools do not grant approvals of their own.

Official MCP presets use the vendors' URLs copied from the original RelayIt,
and the app's existing browser OAuth. Their availability and real accounts have
not been verified. Browser recipes for Swiggy, Zomato, Zepto, Blinkit, Swish and
Uber are best-effort hints. The person signs in in the visible browser and
presses any button that spends money. Secret-field input is refused by bot
browser dispatch and saved-login insertion; trusted human input remains available.

The original provider tests were ported. Payment tool tests now exercise MCP
instead of the old app-specific tool registry. The real-Chrome refusal test
requires `OMB_CDP_CHROME`; without it the test is skipped. No checks here qualify
live Swiggy, Zomato, ONDC, railways, Razorpay or UPI integrations.
