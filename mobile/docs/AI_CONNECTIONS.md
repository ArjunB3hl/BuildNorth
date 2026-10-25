# AI connections and the judge demo

Web and phone: **Profile → AI connections**, also linked from Coach. Mac: **Profile → AI connections**, also linked from Coach. These are two separate ways to use an assistant:

| Option | What it does | Where the credential lives |
| --- | --- | --- |
| Connect ChatGPT or Claude | The external assistant reads your BuildNorth account through `/mcp` and can propose changes for approval. `get_calendar` reads timed meals/workouts, labels demo content, and respects Watch health-sharing consent. | The assistant handles OAuth with your BuildNorth Clerk account. |
| Claude API key on web/phone | Claude answers inside BuildNorth's Coach, using its existing context and Calendar logging. Other AI features retain the server's configured provider. | Encrypted, scoped to the signed-in account on the backend; only its last four characters are returned. |
| Claude API key on Mac | Claude answers inside the Mac demo Coach using local demo profile, preferences, plan and Calendar. Conversations remain local. | Memory only; disconnecting or quitting clears it. Native requests go directly to `https://api.anthropic.com`. |

An Anthropic API key is separate from a Claude subscription and from an MCP connection token. Verification calls the Models API and does not generate a paid message. Sending Coach messages uses the key's API allowance. No judge key is embedded in the app or repository. Get a key from the [Anthropic Console](https://platform.claude.com/settings/keys).

## Demo on localhost

1. Start the BuildNorth API and website, sign in, then open AI connections.
2. Enter a judge-provided Claude API key and an accessible Claude model; select **Verify and connect Claude**.
3. Open Coach and send a message. The existing web/phone completed-event logging continues to feed Calendar.
4. Remove the key after the demo. Coach returns to the server's default provider, if configured. Account-data erasure also deletes the encrypted key.
5. On Mac, attach a key separately. This does not sign the Mac into the live account or synchronize its demo Calendar. Disconnect or quit to forget the key. Local conversation history can be cleared in Coach.

Web/phone key entry requires HTTPS except on localhost. A physical phone must use an HTTPS backend/tunnel; localhost on the phone does not point to the development Mac. No tunnel is created or published automatically.

## Deploy for external assistants

1. Deploy the API behind HTTPS. Set `MCP_PUBLIC_URL=https://api.your-domain/mcp` and the matching `MCP_ALLOWED_HOSTS`. See the existing MCP setup in `mobile/README.md` for Clerk OAuth/CIMD configuration and resource-audience validation. Keep `MCP_REQUIRE_RESOURCE_AUDIENCE=true`.
2. Set `AI_CREDENTIAL_ENCRYPTION_KEY` to a persistent Fernet key shared by all backend workers. Keep it in the deployment secret manager, separate from the database. SQLite development creates a private `ai-credentials.key` beside its database; preserve that key if preserving the database. Do not regenerate a production encryption key on each deploy.
3. Set `WEB_ALLOWED_ORIGINS` to the deployed website origin and rebuild web/phone with `EXPO_PUBLIC_API_URL=https://api.your-domain`. Configure Clerk for the deployed website as well.
4. Set `mac/app.json` → `extra.buildNorthWebUrl` to the deployed website before packaging Mac, or enter it in the Mac connection screen. Mac keeps its demo data local; its account-setup button opens the live website in the system browser.
5. In BuildNorth's AI connections page, copy the server address. In ChatGPT, open **Plugins → + → Add custom MCP server**, choose OAuth, create/install it, and sign in with BuildNorth. In Claude, open **Customize → Connectors → Add → Custom → Web**, choose sign-in and Claude's published identity, then sign in with BuildNorth. Account/workspace policies may control availability. Complete setup on the provider's supported web/desktop surface; mobile access depends on that provider's app and account.
6. Ask the assistant to read your BuildNorth Calendar. The setup screen does not claim a connection succeeded merely because you opened settings. Verify an actual tool response after deployment. Use the existing Content library connections for the separate Rhythm `/rhythm/mcp` endpoint and saved-video tools.

Both providers reach remote connectors from their cloud services, so an unexposed localhost endpoint cannot work. This is expected in the preview; the configured public URL appears automatically after backend deployment. No API key is needed to connect an external ChatGPT/Claude account.

## Verification and limits

Automated checks cover encryption, isolation between users, removal, failure redaction, Coach provider selection, Mac key verification/replies/disconnect, and Calendar MCP access including health consent. No real judge credential or paid message is needed for these tests. External-provider OAuth and a paid Claude response must still be exercised with the deployed URL and a judge's account/key.

References checked October 25, 2026: [ChatGPT MCP setup](https://developers.openai.com/plugins/build/app-quickstart), [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python).
