# @cauthyhq/js

The browser client of Cauthy's [auth-bff protocol](https://github.com/vennet-developers/cauthy-sdk-spec) version 1: who is signed in, every sign-in and account call, the sign-in flow step by step, passkeys and Google One Tap. No framework, no runtime dependency.

The browser never holds a token. Every call goes to your own server under `/api/auth` (a backend SDK serves it: [`@cauthyhq/node`](https://github.com/vennet-developers/cauthy-sdk-node) or `cauthy-sdk-go`), which keeps the session in an HttpOnly cookie. For React, use [`@cauthyhq/react`](https://github.com/vennet-developers/cauthy-sdk-react), built on this package.

```bash
npm install @cauthyhq/js
```

ESM and CommonJS, any bundler. Safe to import while a framework renders on the server: nothing touches `window` until you call it.

## Who is signed in

```ts
import { createSessionStore } from '@cauthyhq/js'

const store = createSessionStore()            // basePath: '/api/auth'
const stop = store.subscribe(({ session, status }) => render(session))   // 'loading' | 'authenticated' | 'unauthenticated'
```

While somebody listens, the store asks the server, asks again shortly before the session runs out and when the tab comes back into view. Pass `initialSession` when the server already read it.

## Your own sign-in screens

```ts
const auth = store.auth                       // or createAuthClient()
const r = await auth.signIn.email({ email, password })
if (!r.ok) show(r.error.message)              // r.error.code, r.error.field, r.error.status
else if (r.next === 'mfa') askForTheCode()    // 'done' | 'mfa' | 'verify_email' | 'code' | …
```

Every call is typed against the protocol's route table (`ROUTES`, generated from the spec). A form is checked here before it is sent, with the rules the server checks again. What changes who is signed in through `store.auth` is heard by the subscribers with no reload.

### The flow, step by step

```ts
import { createSignInFlow } from '@cauthyhq/js'

const flow = createSignInFlow(store.auth)
flow.subscribe(({ step, busy, error }) => render(step.name))   // 'start' | 'mfa' | 'code' | 'verify_email' | 'done' | 'redirect'
await flow.password({ email, password })
await flow.code('123456')
```

The server's `next` decides the step. A backend that does not send `next` yet gets it derived from the answer's status, by the same table.

## Protocol

Every POST carries `X-Cauthy-Request: 1`. Every answer must carry `Cauthy-Protocol: 1`; when it does not, the client warns once: the backend SDK is older than protocol 1 at level `strict`, or another handler answers under `/api/auth`. Pass `onProtocolMismatch` to handle it yourself.

## Errors

`r.error` is `{ code, message, field?, reasons?, status? }`; the codes are the protocol's (`PROTOCOL_ERROR_CODES`). Prefer exceptions? `unwrap(await auth.signIn.email(…))` throws a `CauthyError`. An `unavailable` error with a 4xx `status` (usually 404) means the request did not reach a Cauthy backend: check `basePath`, and that no other handler answers under it.

## Passkeys and Google One Tap

`auth.signIn.passkey()`, `auth.signIn.passkeyAutofill({ signal })`, `auth.account.addPasskey()` run the WebAuthn ceremony (`getPasskey`, `makePasskey` are exported). `auth.signIn.googleOneTap({ signal })` shows Google's prompt and signs in with the account picked (`promptGoogleOneTap` alone shows the prompt).

## Permissions and the look

`can(organization, 'deals', 'write')` reads what the session carries; `definePolicy` types a catalog of roles. `@cauthyhq/js/theme` turns a theme (or your stackmyth or shadcn stylesheet) into the `--cauthy-*` variables the ready-made forms read.

## Moving from `cauthy-auth/client`

Change the import: every name of `cauthy-auth/client` 0.42 is here with the same signature. `pushTheme` is not in the browser package: it takes a personal access token; import it from `@cauthyhq/node/theme` on a server. Guest sessions (`signIn.anonymously`, `account.upgrade*`) still work, warn once, and leave in protocol version 2.

## Development

```bash
npm ci
npm run typecheck && npm test
npm run check:package     # build, publint, attw, the bundle budget, the tarball, npm's dry run
SPEC_DIR=../cauthy-sdk-spec npm run check:routes   # the route table against the spec commit spec.lock pins
```

The bundle budget is 15 kB gzipped for every JavaScript entry as published (`npm run check:size` after a build). `package.json` records, under `allowScripts`, that no dependency's install script runs: tsup's esbuild takes its binary from its platform package (`@esbuild/<platform>`), and `fsevents` ships prebuilt, so neither postinstall is needed.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
