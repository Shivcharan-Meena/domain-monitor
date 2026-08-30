# Domain Monitor

A full-stack domain and subdomain monitoring application built with React, Vite, Node.js, Express, and PostgreSQL.

The application supports public guest checks, authenticated persistent monitoring, Excel import, domain history, groups with permissions and approval workflows, custom dashboards, contact messages, administrator controls, and secure email-based password reset.

---

## 1. Features

### Guest monitoring

Users can use the application without logging in.

- Add multiple domains or subdomains.
- Check domains without creating database records.
- Upload an Excel file containing domains/subdomains.
- Guest results exist only for the current browser session/page state and are not persisted as user data.
- Supports domains such as:
  - `google.com`
  - `www.google.com`
  - `h1.google.com`
  - `h1.h2.google.com`
  - deeper subdomains as well.

### Authentication

- User registration.
- Login/logout.
- Persistent user data stored in PostgreSQL.
- Passwords are hashed with bcrypt.
- JWT-based authentication is used for protected API requests.
- Forgot-password and reset-password workflow through email.

### Domain monitoring

- Add individual domains.
- Upload multiple domains from Excel.
- Enable/disable automatic monitoring for a domain.
- Check one domain at a time.
- Explicitly check all domains.
- View status history.
- View response time.
- Clickable domains open in a new browser tab.
- Supports subdomains and arbitrary subdomain depth.

### Groups

Users can create or join groups.

A group provides a shared domain-monitoring workspace.

#### Group roles

| Permission | View domains | Check | Edit existing domain | Add/upload domains |
|---|---:|---:|---:|---:|
| `view` | Yes | Yes | No | No |
| `edit` | Yes | Yes | Approval required | Approval required |
| `edit_privileged` | Yes | Yes | Immediate | Immediate |
| `admin` / owner | Yes | Yes | Immediate | Immediate |

Group owners can:

- Manage members.
- Change member permissions.
- Approve/reject permission requests.
- Approve/reject pending domain additions.
- Approve/reject pending edits.
- Add/remove group domains.

Group members can see their own outstanding requests in the group dashboard.

### Approval workflow

An `edit` member cannot directly change shared group data.

For example:

```text
Edit member submits domain change
        |
        v
Pending request is created
        |
        v
Group domain remains unchanged
        |
        v
Owner approves
        |
        v
Shared domain is finally changed
```

The same principle applies to domain additions and Excel imports made by an `edit` member.

### Custom dashboards

Saved dashboards can be created from the Groups section and can be scoped to personal domains or a group.

### Contact Us

The public Contact page contains a form for:

- Name
- Email
- Concern/message

Submitted contact messages can be reviewed by administrators.

### Administrator

The platform administrator can manage:

- Users
- Administrator privileges
- Groups
- Domains
- Contact messages

---

## 2. Technology Stack

### Frontend

- React 19
- Vite
- React Router
- Axios
- Recharts
- SheetJS (`xlsx`) for Excel parsing

### Backend

- Node.js
- Express 5
- PostgreSQL
- `pg`
- JWT
- bcryptjs
- Nodemailer
- Axios
- Multer
- node-cron
- SheetJS (`xlsx`)

---

## 3. Project Structure

```text
Domain Monitor/
|
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api.js
│   │   ├── App.jsx
│   │   └── index.css
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
|
└── backend/
    ├── db.js
    ├── monitor.js
    ├── server.js
    ├── schema.sql
    ├── .env.example
    └── package.json
```

---

## 4. Requirements

Install the following before running the project:

- Node.js 18+ recommended.
- npm.
- PostgreSQL database.
- An SMTP email account/provider for password-reset emails.

The project was developed and tested around current Node/npm tooling, but a production deployment should use a supported LTS version of Node.js.

---

## 5. Database Setup

Create a PostgreSQL database.

Example:

```sql
CREATE DATABASE domain_monitor;
```

The backend performs database initialization/migrations during startup. The included `schema.sql` documents the application's expected schema.

Make sure `DATABASE_URL` points to your PostgreSQL instance.

Example:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/domain_monitor
```

For a hosted PostgreSQL provider, use the provider's connection string instead.

---

## 6. Backend Setup

Open a terminal in the backend directory:

```powershell
cd backend
npm install
```

Create a `.env` file by copying `.env.example`:

```powershell
copy .env.example .env
```

Then fill in the real values.

Start the backend:

```powershell
npm start
```

For development with automatic restarts:

```powershell
npm run dev
```

The API normally runs at:

```text
http://localhost:5000
```

Health check:

```text
GET http://localhost:5000/api/health
```

---

## 7. Frontend Setup

Open a second terminal:

```powershell
cd frontend
npm install
```

Create the frontend environment file:

```powershell
copy .env.example .env
```

For local development, the frontend can leave `VITE_API_URL` empty because Vite proxies `/api` to the backend.

Start the frontend:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173
```

---

## 8. Environment Variables

### Backend `.env`

```env
PORT=5000

DATABASE_URL=postgresql://postgres:password@localhost:5432/domain_monitor

FRONTEND_URL=http://localhost:5173
PUBLIC_APP_URL=http://localhost:5173

JWT_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=

CHECK_INTERVAL_MINUTES=5
REQUEST_TIMEOUT_MS=10000
RESET_TOKEN_MINUTES=30

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
MAIL_FROM=no-reply@example.com
```

### Frontend `.env`

For local development:

```env
VITE_API_URL=
```

If the frontend and backend are hosted separately:

```env
VITE_API_URL=https://api.example.com/api
```

---

## 9. Gmail SMTP Setup

For development/testing, Gmail can be used as the SMTP provider.

Use a Google App Password rather than the normal Gmail password.

Example configuration:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=kasdo13@gmail.com
SMTP_PASS=YOUR_16_CHARACTER_GOOGLE_APP_PASSWORD
MAIL_FROM=kasdo13@gmail.com
```

Google displays the App Password with spaces for readability. In `.env`, use the value without spaces.

Example:

```text
abcd efgh ijkl mnop
```

becomes:

```env
SMTP_PASS=abcdefghijklmnop
```

### Important

The SMTP credentials belong only in `backend/.env`.

Do not place SMTP credentials in frontend files, commit them to Git, or expose them to the browser.

---

## 10. Password Reset Security

Password reset is designed so a user must control the registered email inbox.

Flow:

```text
User enters email
       |
       v
Server creates one-time random reset token
       |
       v
Only token hash is stored in PostgreSQL
       |
       v
Reset link is sent to registered email
       |
       v
User opens link from the email
       |
       v
Token + new password are submitted
       |
       v
Server validates token and expiry
       |
       v
Password is changed
```

Security behavior includes:

- Reset tokens are random.
- Only a hash of the token is stored in the database.
- Tokens expire after `RESET_TOKEN_MINUTES`.
- Tokens are single-use.
- Previously outstanding reset tokens are invalidated when appropriate.
- The reset endpoint does not return the raw reset token.
- The forgot-password response is intentionally generic so an attacker cannot easily discover whether an email is registered.
- Reset requests are rate-limited.

### Production requirement

Use HTTPS in production and set:

```env
PUBLIC_APP_URL=https://your-real-domain.example
```

---

## 11. Domain Check Behavior

The monitor normalizes user input before checking it.

These are valid examples:

```text
google.com
www.google.com
h1.google.com
h1.h2.google.com
api.eu.example.com
https://example.com
https://h1.example.com
```

A remote website can still return an HTTP error such as `403` even when the application successfully reaches it.

For example:

```text
403 = the remote website responded with HTTP 403
```

This should not automatically be interpreted as the monitoring application being broken.

Some websites block automated requests or require browser-specific behavior.

---

## 12. Scheduled Monitoring

Enabled domains participate in scheduled monitoring.

The interval is controlled by:

```env
CHECK_INTERVAL_MINUTES=5
```

A disabled domain remains stored but is skipped by scheduled monitoring.

Manual checks are still available where the user's permission permits them.

The application also provides an explicit "Check all" action so users can intentionally trigger a bulk check rather than accidentally checking every domain when checking one row.

---

## 13. Important Group Rules

### View member

Can:

- Open the group dashboard.
- See group domains.
- Check domains.
- View monitoring data/history.
- Request a higher permission.

Cannot:

- Directly edit group domains.
- Directly add group domains.
- Directly upload group Excel data.

### Edit member

Can:

- View group domains.
- Check domains.
- Submit domain edits for owner approval.
- Submit new-domain requests for owner approval.
- Submit Excel imports as pending additions.

The shared group data does not change until the owner approves the request.

### Privileged edit member

Can:

- View and check domains.
- Add domains immediately.
- Upload Excel immediately.
- Edit existing domains immediately.

### Group owner/admin

Can:

- Manage group members.
- Set member permissions.
- Save permission changes explicitly.
- Approve/reject requests.
- Manage shared domains.
- Use the full group monitoring dashboard.

---

## 14. API Overview

### Public endpoints

```text
GET    /api/health
POST   /api/guest/check
POST   /api/guest/upload
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/contact
```

### Authentication

```text
GET    /api/auth/me
```

### Domains

```text
GET    /api/domains
POST   /api/domains
PUT    /api/domains/:id
PATCH  /api/domains/:id/toggle
DELETE /api/domains/:id
POST   /api/domains/:id/check
POST   /api/domains/check-all
GET    /api/domains/:id/history
POST   /api/domains/upload
```

### Groups

```text
GET    /api/groups
POST   /api/groups
POST   /api/groups/join
GET    /api/groups/:id
POST   /api/groups/:id/members
PATCH  /api/groups/:id/members/:userId
DELETE /api/groups/:id/members/:userId
POST   /api/groups/:id/domain
POST   /api/groups/:id/domains
DELETE /api/groups/:id/domains/:domainId
POST   /api/groups/:id/check-all
POST   /api/groups/:id/upload
```

### Group approval requests

```text
POST /api/groups/:id/edit-requests/:requestId
POST /api/groups/:id/domain-add-requests/:requestId
POST /api/groups/:id/permission-requests
POST /api/groups/:id/permission-requests/:requestId
```

### Dashboards

```text
GET    /api/dashboard
GET    /api/history/recent
GET    /api/dashboards
POST   /api/dashboards
GET    /api/dashboards/:id
DELETE /api/dashboards/:id
```

### Administration

```text
GET    /api/admin/stats
GET    /api/admin/users
PATCH  /api/admin/users/:id
DELETE /api/admin/users/:id
GET    /api/admin/groups
DELETE /api/admin/groups/:id
GET    /api/admin/contacts
GET    /api/admin/domains
DELETE /api/admin/domains/:id
```

---

## 15. Excel Upload Format

The application accepts Excel files through SheetJS.

For the safest import, put one domain/subdomain per row in the first column.

Example:

| Domain |
|---|
| google.com |
| www.google.com |
| h1.google.com |
| h1.h2.google.com |
| example.org |

Header naming is flexible in the application, but keeping the first column dedicated to domain values is recommended.

---

## 16. Troubleshooting

### CORS error in the browser

For local development:

```env
FRONTEND_URL=http://localhost:5173
```

and leave frontend `VITE_API_URL` empty:

```env
VITE_API_URL=
```

Then restart both servers.

### Frontend does not load after code changes

Stop Vite and restart it:

```powershell
Ctrl+C
npm run dev
```

If an old bundle is cached:

```text
Ctrl + Shift + R
```

### Password reset email is not received

Check:

- SMTP host.
- SMTP port.
- SMTP secure setting.
- SMTP username.
- SMTP App Password/password.
- `MAIL_FROM`.
- `PUBLIC_APP_URL`.
- Spam/junk folder.

For Gmail, use an App Password rather than the normal Gmail password.

### Domain returns 403

A 403 means the remote server responded with HTTP 403. It does not necessarily mean the domain is unreachable.

### Group shows zero domains

Make sure domains are actually associated with the group. Creating a group without selecting domains can associate eligible ungrouped personal domains depending on the current group initialization behavior.

---

## 17. Security Notes

Never commit the following to a public repository:

```text
backend/.env
API keys
SMTP passwords
JWT secrets
PostgreSQL credentials
```

Use `.env.example` only as a template.

For production:

- Use HTTPS.
- Use a strong randomly generated JWT secret.
- Use a managed PostgreSQL instance or secured PostgreSQL deployment.
- Use a transactional SMTP provider or organization SMTP service.
- Keep dependencies updated.
- Apply server-side authorization; do not rely only on hiding UI controls.
- Back up the database.
- Configure appropriate reverse proxy/rate limiting/WAF controls.

---

## 18. Production Build

Frontend production build:

```powershell
cd frontend
npm run build
```

Preview the production frontend locally:

```powershell
npm run preview
```

The backend is started with:

```powershell
cd backend
npm start
```

For production deployment, place the frontend behind a web server/reverse proxy and run the backend as a managed service such as PM2, Docker, systemd, or the hosting provider's process manager.

---

## 19. First Administrator

The project supports administrator management through the backend configuration and registration/admin logic.

Set `ADMIN_EMAIL` where appropriate for the deployment, then verify the user's administrator status through the Administrator page after login.

Do not expose administrator-only routes to unauthenticated users.

---

## 20. Quick Start Summary

```powershell
# Terminal 1
cd backend
npm install
copy .env.example .env
# edit .env
npm start
```

```powershell
# Terminal 2
cd frontend
npm install
copy .env.example .env
npm run dev
```

Open:

```text
http://localhost:5173
```

---

## 21. Notes for Contributors

When adding or changing a feature:

1. Update server-side authorization first.
2. Update database schema/migrations if persistent state changes.
3. Update frontend API helpers.
4. Make loading/processing states visible on buttons.
5. Avoid full-page reloads when a local state update is sufficient.
6. Keep guest data separate from authenticated persistent data.
7. Do not expose secrets to the frontend.
8. Run JavaScript/JSX syntax checks and a full production build before release.

---

## License

No explicit license is included in the current project. Add a license file before public distribution if required.
