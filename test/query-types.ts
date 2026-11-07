// Checked by tsc, never run: a route's query is typed by the spec's
// RouteQueries, so a misspelt or missing parameter fails the typecheck.
import { createTransport } from '../src/transport'

const t = createTransport()
export const ok = [
  t.href('sign-in.social', { return_to: '/deals', remember: '1' }, 'google'),
  t.href('session.get'),
  t.read('organizations.members', { id: 'o1' }),
  t.get('sign-in.invitation', { token: 't1' }),
]
// @ts-expect-error: organizations.members has no `idd`
t.read('organizations.members', { idd: 'o1' })
// @ts-expect-error: organizations.members needs its `id`
t.read('organizations.members', {})
// @ts-expect-error: sign-in.social has no `returnTo`; the query says `return_to`
t.href('sign-in.social', { returnTo: '/deals' }, 'google')
// @ts-expect-error: session.get takes no query
t.href('session.get', { x: '1' })
