# Initial data model decisions

- A `ChoirMembership` is the tenant-specific identity and role assignment for a user. The `(userId, choirId)` unique constraint prevents duplicate membership.
- Membership section links use a composite `(sectionId, choirId)` foreign key. A valid section UUID from another choir cannot be assigned through the database.
- A normalized choir name is globally unique for unambiguous name-based sign-in; normalized member names are unique within each choir.
- User language preferences are stored on `User`, and each choir membership stores the normalized member name used for sign-in.
- Platform staff authorization is a separate `User.platformRole`; choir roles do not grant platform privileges. User suspension revokes active sessions.
- Platform status changes and security events are platform-scoped and visible only to super administrators. Financial records remain keyed to one choir; each edit stores before/after snapshots and a required reason. Expense approval and transaction verification record a different authorized actor than the original recorder.
- Member contribution records reference an active choir membership and a month; effective-dated contribution policies and authorized exemption periods calculate expected, paid, and outstanding dues without combining currencies. Annual registers include each choir member, each month, annual totals, and a signature column.
- Financial budgets, contribution policies, exemptions, expense decisions, receipt attachments, and record corrections are choir-scoped and create audit entries. Receipt files use generated names and authenticated tenant-checked downloads.
- Announcements with no choir links are global; announcements with links are delivered only to those choirs. Support-ticket replies are private to the requester and authorized support staff.
- System settings store only an explicit allow-list of application defaults, never credentials or secret keys.
- Choir-owned tables include `choirId`; all API reads and writes additionally scope records to an active choir membership.
- Sessions store hashes of high-entropy random tokens, not the usable bearer tokens.
- Songs are archived rather than physically deleted.
- `AuditLog` records administrator membership changes and is only readable by choir administrators through the API.
- PostgreSQL check constraints enforce valid rehearsal time ranges, song tempo bounds, and positive song durations. These checks are expressed in the initial SQL migration because Prisma's schema language does not currently represent `CHECK` constraints.
- Director workflows use choir-scoped event, setlist, participant, attendance, practice, announcement, task, note, and song-resource models. API writes validate that all referenced members, sections, rehearsals, and songs belong to the active choir.
- Uploaded song resources are stored under `server/uploads/choir-resources/<choirId>/` using generated filenames, have an enforced 25 MB limit, and are delivered only through authenticated choir-scoped downloads. External resource URLs must use HTTPS.
- Money movement and payment integrations are deliberately not implemented. Receipt files are stored outside the web root in `server/uploads/financial-receipts/<choirId>/`, limited to PDF/JPEG/PNG/WebP and 10 MB, and never served as public static files. CSV reports are Excel-compatible; the contribution register uses a print view for browser PDF export.
