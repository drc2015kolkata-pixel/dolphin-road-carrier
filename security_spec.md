# Security Specification — Dolphin Road Carriers ERP

## 1. Data Invariants
1. **Identity Integrity**: Every business document (`parties`, `vehicles`, `drivers`, `consignments`, `invoices`, `quotations`, `lorry_hires`, `transactions`, `declarations`, `settings`) MUST store `ownerUid == request.auth.uid` on creation and preserve `ownerUid` immutably on update, OR be operated by a verified Master Admin (`drc.2015kolkata@gmail.com` with `email_verified == true`, or listed in `/admins/{uid}`).
2. **POD Payment Lock Invariant**: On `/lorry_hires/{hireId}`, `balancePaid` MUST NEVER be `true` unless `podReceived == true`, `podReceiveDate` is a valid non-empty date string (`size() >= 8`), and `podFileName` is present (`size() >= 1`).
3. **Temporal Integrity**: `createdAt` and `updatedAt` MUST match `request.time` on creation; `createdAt` is immutable on update and `updatedAt == request.time`.
4. **No Self-Assigned Admin Privileges**: Non-admin users cannot write `/admins/{uid}` or `/staff_accounts/{staffId}` to grant themselves admin or elevated staff permissions.
5. **Strict Payload Boundaries**: Every string field enforces `.size() <= maxLength`; arrays (`consignmentRows`, `annexureLorries`, `permissions`) enforce strict `.size() <= MAX`; no shadow/ghost fields allowed (`keys().hasOnly(...)`).
6. **Verified Auth & Secure List Queries**: All reads/writes require `request.auth != null && request.auth.token.email_verified == true`, and `allow list` explicitly checks `resource.data.ownerUid == request.auth.uid || isAdmin()`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Create**: `POST /transactions/tx1` with `ownerUid: "victim_uid"` while authenticated as attacker. Expected: `PERMISSION_DENIED`.
2. **Ghost/Shadow Field Injection**: `POST /parties/p1` with all valid fields plus `isAdmin: true`. Expected: `PERMISSION_DENIED`.
3. **POD Payment Lock Bypass on Create**: `POST /lorry_hires/h1` with `podReceived: false, balancePaid: true`. Expected: `PERMISSION_DENIED`.
4. **POD Payment Lock Bypass on Update**: `PATCH /lorry_hires/h1` setting `balancePaid: true` when `podReceiveDate: ""`. Expected: `PERMISSION_DENIED`.
5. **Unverified Email Bypass**: Request with `email: "drc.2015kolkata@gmail.com"` and `email_verified: false`. Expected: `PERMISSION_DENIED`.
6. **ID Poisoning**: Document ID > 128 chars or containing `$` / `/` characters. Expected: `PERMISSION_DENIED`.
7. **Unbounded Array / DoS**: `POST /invoices/inv1` with `consignmentRows.size() == 250`. Expected: `PERMISSION_DENIED`.
8. **Type Poisoning on Update**: `PATCH /invoices/inv1` setting `grandTotal: "free"` (string instead of number). Expected: `PERMISSION_DENIED`.
9. **Immutable Owner Tampering**: `PATCH /consignments/cn1` attempting to change `ownerUid` or `createdAt`. Expected: `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: `POST /transactions/tx2` with backdated `createdAt` != `request.time`. Expected: `PERMISSION_DENIED`.
11. **Privilege Escalation on Staff Accounts**: Non-admin user attempting `POST /staff_accounts/s1` with `role: "Admin"`. Expected: `PERMISSION_DENIED`.
12. **Blanket List Scraping**: Non-admin user listing `/parties` without `where("ownerUid", "==", uid)`. Expected: `PERMISSION_DENIED`.
