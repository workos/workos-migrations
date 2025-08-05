I have this tool ~/Projects/migrate-auth0-enterprise-connections what initally, just export data from Auth0.
Now I want to make this new tool more generic. It will cover more providers and entities to be exported and imported to WorkOS.

The CLI flow should look like this:

1. Select the provider (e.g. Auth0, Clerk, Firebase, AWS Cognito)
2. Ask for provider credentials, tokens etc, for example, for Auth0: CLIENT_ID, CLIENT_SECRET and DOMAIN
3. Do a initial fetch on the entities available in the access token. Highlight the scopes that the access token have access (e.g. Auth0 case)
4. Shows available entities and user can select the entities. For example, for Auth0: Users, Roles, Permissions, Organizations, Organization Members, Connections.

The tool needs to be interactive (use same tool as in ~/Projects/migrate-auth0-enterprise-connections), but all those parameters requested should also be available as arguments. For example, you could do `npx github:workos/workos-migrations auth0 export --entities users,connections`. As long as you have `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, and `AUTH0_DOMAIN` set, it will export the data automatically. You can also set credentials in a ~/.workos-migrations/config.json

Make the project very maintainable by separating providers logic in directories.

The first iteration will have just Auth0 export, but you should also show Clerk, Firebase, AWS Cognito options which will actually record a feature request.
