=== ChallengeForge ===
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT

Link WordPress pages to ChallengeForge challenges, and sign your members straight in.

== Description ==

Add `[challengeforge challenge="<challenge id>" label="Start"]` to any page or post.

* Visitors who are not signed in to WordPress get an ordinary link.
* Signed-in members, when single sign-on is set up, arrive signed in to
  ChallengeForge as their own account there. That account is linked by
  WordPress user id, never by email. The sign-in uses a two-minute,
  single-use token signed with a secret only the two sites share, and it
  is sent as a form POST, so it never appears in a URL.

== Installation ==

1. Upload the `challengeforge` folder to `wp-content/plugins/`, then activate the plugin.
2. In ChallengeForge, open **Admin → WordPress**. Enter this site's address
   exactly as shown in WordPress under Settings → General → Site Address,
   and copy the secret that ChallengeForge shows you.
3. In WordPress, open **Settings → ChallengeForge**, then paste the ChallengeForge
   address and the secret.
