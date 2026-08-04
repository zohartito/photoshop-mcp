import assert from 'node:assert/strict';
import { UxpBridgeSessionAuthority } from '../src/platform/uxp-bridge-session.js';

const authority = new UxpBridgeSessionAuthority();
const owner = 'owner-session-012345';
const late = 'late-session-0123456';

assert.equal(authority.establishInitial(owner, false), true);
assert.equal(authority.isCurrent(owner), true);

// A lost handshake response may be retried by the exact owner. This is an
// idempotent acknowledgement, not a new establishment or a state reset.
assert.equal(authority.establishInitial(owner, false), true);
assert.equal(authority.establishInitial(owner, true), true);
assert.equal(authority.isCurrent(owner), true);

// A superseded plugin cannot take ownership or make its later poll/result alter
// bridge state. The bridge must keep recognizing only the original session.
assert.equal(authority.establishInitial(late, false), false);
assert.equal(authority.isCurrent(late), false);
assert.equal(authority.isCurrent(owner), true);

const noOwnerWhileQuarantined = new UxpBridgeSessionAuthority();
assert.equal(noOwnerWhileQuarantined.establishInitial(late, true), false);
assert.equal(noOwnerWhileQuarantined.isCurrent(late), false);

// Bridge-process shutdown followed by plugin reload and a fresh handshake is
// the explicit recovery boundary; an in-process plugin reload cannot take over.
authority.clearForProcessShutdown();
assert.equal(authority.establishInitial(late, false), true);
assert.equal(authority.isCurrent(late), true);

console.log(
  'UXP bridge session authority: exact retry is idempotent; superseded session has zero effects'
);
