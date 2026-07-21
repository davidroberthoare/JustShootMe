# JustShootMe 📸

A little self-hosted photobooth web app, built for a special event I'm involved with. Guests snap photos right in the browser — no app to install — and get them back by QR code or email.

## Try it out

There's a hosted version running at [justshootme.drhmedia.net](https://justshootme.drhmedia.net) and you're welcome to use it! Just keep in mind it's a hobby project, so I can't guarantee much in the way of privacy or security. Photos are kept for 7 days and then they're deleted for good.

## Running your own

Plain PHP (using [Slim](https://www.slimframework.com/)) with SQLite — no frontend build step.

```bash
composer install
cp .env.example .env          # fill in APP_SECRET, APP_URL, SES SMTP creds, etc.
php bin/create_admin.php you@example.com 'a-strong-password'
php -S localhost:8080 -t public public/router.php
```

Then visit `localhost:8080/admin/` to set up an event, or `localhost:8080/booth/?code=YOUR-CODE` to try the booth itself.

## Thanks

Built with some great open-source projects — [Slim](https://www.slimframework.com/), [Bulma](https://bulma.io/), and [Phosphor Icons](https://phosphoricons.com/). Cheers to everyone who makes that stuff free for the rest of us. 🇨🇦
