# CourseReserve — Online Course Reservation System
**College Software Engineering Laboratory Project**

CourseReserve is a full-stack academic course reservation and verification platform designed and implemented for a university Software Engineering Laboratory. The system enforces strict ACID transactional guarantees, zero overbooking, server-authoritative role-based access control, and an interactive testing module encompassing Unit, Integration, White-Box, Black-Box, and Generative AI-assisted test engineering.

---

## 1. System Architecture & Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend**: Node.js, Express, TypeScript (`server.ts`)
- **Database & State**: Persistent transactional data store (`data/db.json`) with an in-memory Mutex lock enforcing atomic serialization on reservation and cancellation transactions
- **Authentication**: HMAC-SHA256 cryptographically signed bearer tokens with timing-safe PBKDF2/scrypt password hashing
- **Testing Engine**: Vitest CLI automated test suites + in-app interactive automated test runner (`server/testRunner.ts`)
- **Compatibility**: 100% Free-Tier compatible with zero external paid API dependencies

---

## 2. User Roles & Pre-Seeded Demonstration Accounts

For convenient evaluation, the system includes pre-seeded accounts and a 1-click **Demo Switcher** in the navigation bar:

### A. Student Accounts
1. **Alex Rivera** (3rd Year Computer Science)
   - Email: `student@college.edu`
   - Password: `StudentPassword123!`
   - Capabilities: Browse courses, view seat counts, atomically reserve courses, view unique voucher IDs (`RES-2026-XXXXX`), cancel reservations with automatic seat restoration, edit student profile.
2. **Sarah Chen** (2nd Year Software Engineering)
   - Email: `sarah.chen@college.edu`
   - Password: `StudentPassword123!`

### B. Administrator Account
1. **Prof. Katherine Vance** (Lab Coordinator & System Admin)
   - Email: `admin@college.edu`
   - Password: `AdminPassword123!`
   - Capabilities: Full operations dashboard, course creation & updates, capacity quota adjustments, publishing/unpublishing/archiving courses, administrative reservation cancellations with audit logging, CSV export reports, and Software Testing suite execution.

---

## 3. Core Business & Concurrency Rules

1. **Atomic Seat Decrement**: Every reservation acquires a critical-section mutex. Seat counts decrement atomically and are persisted safely to disk.
2. **Zero Overbooking Guarantee**: Courses with `availableSeats <= 0` immediately reject reservation requests with `HTTP 409 Conflict`.
3. **Duplicate Prevention**: A student with an active reservation for course $X$ cannot make a second active reservation for course $X$.
4. **Idempotent Capacity Restoration**: Valid reservation cancellations restore course capacity by exactly 1. Double cancellations or unauthorized cancellations across students are strictly rejected.
5. **Server-Authoritative Authorization**: Administrative privileges are strictly verified by server tokens; client-side role tampering is blocked.

---

## 4. Software Engineering Testing Module

The built-in **Software Testing Lab Dashboard** tracks 18 comprehensive test cases:

- **Unit Testing**: RFC 5322 email regex assertions, 5-point password strength policy, seat availability validators, course payload rules.
- **Integration Testing**: End-to-end atomic reservation, capacity restoration on cancellation, duplicate booking rejection, cross-student authorization barriers.
- **White-Box Testing (evaluateReservationEligibility)**:
  - **Statement Coverage**: 100% of statements (1 through 11) traversed.
  - **Branch Coverage**: 10/10 decision outcomes (True and False branches) tested.
  - **Condition Testing**: Compound boolean sub-conditions evaluated independently.
  - **Basis Path Testing**: Cyclomatic Complexity $V(G) = E - N + 2P = 14 - 10 + 2 = 6$ linearly independent basis paths.
- **Black-Box Testing**:
  - **Equivalence Partitioning**: Valid and invalid classes for email, password, and course quotas.
  - **Boundary Value Analysis**: Behavior at $seats = -1, 0, 1,$ and $capacity$.
  - **Decision Table Testing**: Truth table covering 8 distinct condition rules.
  - **Error Guessing**: Double-cancellation idempotency and script injection sanitization.
- **Generative AI-Assisted Testing**:
  - Reusable IEEE SRS prompt template generator.
  - Human-in-the-Loop test case review workflow (Accepted, Rejected, Needs Revision).
- **Concurrency & Race Condition Simulator**:
  - Interactive test harness firing 5 concurrent threads targeting 1 available seat. Proves that exactly 1 succeeds and 4 receive `409 Course Full`, ensuring zero overbooking.

---

## 5. Getting Started & Setup

### Development
```bash
# Install dependencies
npm install

# Start full-stack server (Node.js + Vite middleware on Port 3000)
npm run dev
```

### Running Automated Tests via CLI
```bash
# Execute Vitest test suites
npm run test
```

### Building for Production
```bash
# Build frontend assets
npm run build

# Start production server
npm run start
```

---

## 6. Environment Variables

Defined in `.env.example`:
- `PORT`: Server port (default: `3000`)
- `JWT_SECRET`: Signing secret for HMAC authentication tokens
- `NODE_ENV`: `development` or `production`
