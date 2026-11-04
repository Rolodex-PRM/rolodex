# Rolodex

Rolodex is a self-hosted relationship manager for one server and the people an account is allowed to see. It is the address book, the calendar, the task list, and the history of how you know someone. Phones and computers sync a copy. The photo library can stay in Immich.

## Accounts and workspaces

The first visit creates the administrator. Later registration is invite-only until an administrator turns that off under Admin → Security. A person signs in with an email and password. An administrator can also offer an OpenID provider such as Authentik, Authelia, or Keycloak. Password sign-in stays available.

A second factor is optional until an administrator requires it. The methods are an authenticator app and an emailed code. Authenticator apps that speak TOTP work, including Microsoft Authenticator, Google Authenticator, Authentik, and 1Password. Email codes go to the sign-in address and need Admin → Notifications email turned on.

A workspace holds the people, books, calendar, and tasks. Roles:

- Owner runs the workspace, including backups.
- Administrator manages users, invitations, security, and server settings.
- Editor adds and changes people, events, and tasks.
- Contributor and Viewer can look and cannot change people.

A user group exists so one person can be shared with several accounts. View can see that person. Edit can change them.

## People

A person has the usual card fields: name, preferred name, job title, company, phone, email, address, birthday, and website. The card note syncs to the phone. How you met, interests, tags, and private notes stay in Rolodex.

The company name on the card is the text printed on that card. An organization membership is separate and can include a role at that company. One person can belong to more than one organization.

Reach out is how often Home should suggest getting back in touch. Relationships are named on both sides, such as parent and child. An address book is the set of people a sync client receives. A person can be in more than one book.

Deleted people sit in Trash until someone restores them, empties the trash, or the retention period ends. Restoring a person publishes them on the next phone check-in.

## Sync clients

CardDAV is the address book. CalDAV is the calendar and the tasks. Both use the same server, the same email, and a client password created under Settings. Each client has a name and a last check-in time. The website password is only for signing in to the site.

iPhone and iPad use a CardDAV account and a separate CalDAV account. Android can use DAVx5 with the base URL. Mac uses Internet Accounts. Thunderbird and other CardDAV or CalDAV apps use the base URL. People who already live in iCloud or Google stay there until a vCard is exported and imported.

Derived birthdays and anniversaries are read-only on the phone.

## Mail, calendars, and photos

Settings → Mail and calendars connects an IMAP mailbox and an external CalDAV or ICS calendar. Checking the account imports recent mail and events. This is not a Rolodex sign-in and not a phone client.

Immich stays the owner of photos and face recognition. Rolodex stores the link between an Immich person and a contact. AI suggestions stay pending until someone approves them. Both add-ons stay off until an administrator enables them.

## What an administrator sets

Admin → Security turns invite-only registration and the second factor on or off, and chooses authenticator apps, email codes, or both.

Admin → Users invites people, changes roles, and manages groups.

Admin → Sign-in is the OpenID provider. The issuer, client id, and redirect URI are the fields a provider asks for. The other fields change the protocol, the button, and where a person manages their account at that provider.

Admin → Notifications sends due reminders by email, browser push, or a webhook. The link URL is the address placed in those messages. The push subject is a contact address for the browser push service, usually `mailto:you@example.com`, not the notification title.

Admin → Audit lists recent changes in plain language. Admin → Map chooses the map used for addresses. Admin → Relationships names both sides of a relationship. Admin → Appearance stores server CSS. Only appearance properties are kept.
