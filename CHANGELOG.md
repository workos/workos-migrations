# Changelog

## [2.3.0](https://github.com/workos/workos-migrations/compare/v2.2.0...v2.3.0) (2026-05-28)


### Features

* Split connections template into SAML/OIDC and add name to users ([#91](https://github.com/workos/workos-migrations/issues/91)) ([7605c70](https://github.com/workos/workos-migrations/commit/7605c70544a94d40c575e754ce89e7aa5eabcf7d))

## [2.2.0](https://github.com/workos/workos-migrations/compare/v2.1.3...v2.2.0) (2026-05-28)


### Features

* Add export-template command for CSV templates ([#90](https://github.com/workos/workos-migrations/issues/90)) ([11a74b8](https://github.com/workos/workos-migrations/commit/11a74b8dfa44573fbbcbbc2d2f3f7d2bc17382c3))
* add generate-package-template and validate-package commands ([#58](https://github.com/workos/workos-migrations/issues/58)) ([d0f97d0](https://github.com/workos/workos-migrations/commit/d0f97d0467f937ef3eceea90ae46230bc2425878))
* clerk package parity ([#59](https://github.com/workos/workos-migrations/issues/59)) ([904f39c](https://github.com/workos/workos-migrations/commit/904f39cbf41b4fe14f690d41064e03e31852eaf4))
* cognito package parity ([#57](https://github.com/workos/workos-migrations/issues/57)) ([b15e5c1](https://github.com/workos/workos-migrations/commit/b15e5c10710efc2de9fc09d206591363af2a93ea))
* firebase package parity ([#60](https://github.com/workos/workos-migrations/issues/60)) ([6b5daa3](https://github.com/workos/workos-migrations/commit/6b5daa3dbd06a27301c41b0735c25b0a01943fe3))

## [2.1.3](https://github.com/workos/workos-migrations/compare/v2.1.2...v2.1.3) (2026-05-27)


### Bug Fixes

* update npm for release management ([#85](https://github.com/workos/workos-migrations/issues/85)) ([ebf7973](https://github.com/workos/workos-migrations/commit/ebf79735929dc9c4fec7af5b719f5f7748cc3091))

## [2.1.2](https://github.com/workos/workos-migrations/compare/v2.1.1...v2.1.2) (2026-05-27)


### Bug Fixes

* use OIDC provenance for npm publish ([#72](https://github.com/workos/workos-migrations/issues/72)) ([bbad524](https://github.com/workos/workos-migrations/commit/bbad524697cabb2d6ac6a966c0f58be11a785a45))

## [2.1.1](https://github.com/workos/workos-migrations/compare/v2.1.0...v2.1.1) (2026-05-13)


### Bug Fixes

* npm publish OIDC auth and prettier CHANGELOG ([#70](https://github.com/workos/workos-migrations/issues/70)) ([e7b8df6](https://github.com/workos/workos-migrations/commit/e7b8df67215f0efcfb6963151ecb4c705252985d))

## [2.1.0](https://github.com/workos/workos-migrations/compare/v2.0.0...v2.1.0) (2026-05-13)


### Features

* add auth0 package export core ([d9c5e93](https://github.com/workos/workos-migrations/commit/d9c5e936113b31f2ae3ea9ea14d42323719353fc))
* add auth0 package export core ([28f99dd](https://github.com/workos/workos-migrations/commit/28f99ddf2a06ea2b944dc16abe01f16acb90671a))
* add auth0 sso handoff export ([6b40ba9](https://github.com/workos/workos-migrations/commit/6b40ba9152c3212307f790023a1db80d945f57f0))
* add import-package orchestrator ([1384b5e](https://github.com/workos/workos-migrations/commit/1384b5ebb548a57e0fbf6cb1ba379dbaabab18b3))
* add migration package contract ([d3290e6](https://github.com/workos/workos-migrations/commit/d3290e6ac8127b7b884e8de897def5fae0b243a4))
* add migration package contract ([d49adfa](https://github.com/workos/workos-migrations/commit/d49adfa0448ca4572202e37ad108594a27b26cfe))
* add shared sso handoff utilities ([b2f4078](https://github.com/workos/workos-migrations/commit/b2f4078ef16f8e3b024f3112c2eabe2716bb96f7))
* add shared sso handoff utilities ([e6577b0](https://github.com/workos/workos-migrations/commit/e6577b0727eb8a15964fbd7dd9f855bd5f6eabc5))
* **cognito:** external_id roundtrip + --skip-external-provider-users flag ([de9eca0](https://github.com/workos/workos-migrations/commit/de9eca021e26ae07674fcdf438387f9fd9e239a9))
* expand auth0 management api client ([5936a41](https://github.com/workos/workos-migrations/commit/5936a41873c4e4fd09be8ef5057bd39ba68a6391))
* expand auth0 management api client ([6d2895b](https://github.com/workos/workos-migrations/commit/6d2895b4c9d9e535b19036f4500ab7369e193136))
* export Auth0 roles and per-org assignments ([99b1dc8](https://github.com/workos/workos-migrations/commit/99b1dc89ec8b3c47aee559d9c94f1b31343e1e94))
* package-aware password merge and Auth0 bulk-job engine ([1c5de6c](https://github.com/workos/workos-migrations/commit/1c5de6c6af024931c0c2a753a7e2525748120ce0))
* wizard package mode, Auth0 docs, and end-to-end fixture ([4b358c4](https://github.com/workos/workos-migrations/commit/4b358c4019ac02ff3ec625ccc41d7c4330cf7777))


### Bug Fixes

* **import-package:** resolve org external IDs and preserve error cause ([ca43cf9](https://github.com/workos/workos-migrations/commit/ca43cf95e4143029b2ca410f44ba951cfb4356c6))
* infer auth0 enterprise sso protocols ([927c26a](https://github.com/workos/workos-migrations/commit/927c26aef8280b005f957a32a3251b4792e3f513))
* publish @workos/migrations to npm ([#65](https://github.com/workos/workos-migrations/issues/65)) ([8dcb382](https://github.com/workos/workos-migrations/commit/8dcb382271b4940cbc67672d37a63b39082a656a))
* use GITHUB_TOKEN for release-please ([#68](https://github.com/workos/workos-migrations/issues/68)) ([0af7ba5](https://github.com/workos/workos-migrations/commit/0af7ba5099698ff70d993b1dde22934274a3f576))
* **wizard:** use package-aware password merge in package mode ([b253635](https://github.com/workos/workos-migrations/commit/b2536352275ec585759696261902ab1c7ca3798a))
