# proto

The wire protocol, defined once. A leaf module: it names no other muxen module, so
`http/` and `hub/` both use it.

`web/proto/generated/messages.ts` is rendered from these types (ts-rs) by the test in
`typescript.rs`, which fails while the committed file is stale. After changing a wire
type run `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript` and commit the file.
A new type the web uses goes in `declarations()`. The `/auth/*` bodies (`auth.rs`) have
no TypeScript: Swift mirrors them, and `ErrorBody`, by hand.

Bump `PROTOCOL_VERSION` when an older peer would act wrongly on the new shape: a changed
meaning, or a removed or renamed field or message it would misread. A removed field whose
absence an older peer reads as its harmless default needs no bump; nor do optional fields
and new message types, which both sides ignore. Binary frames are checked against
`tests/fixtures/proto/frames.json`, which `web/proto/frames.ts` can test against too.
