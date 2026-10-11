import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { db, hashPassword, verifyPassword } from './server/db';
import { 
  generateToken, 
  authenticateToken, 
  optionalAuth, 
  requireAdmin, 
  requireStudent, 
  AuthenticatedRequest 
} from './server/auth';
import { 
  validateRegistrationPayload, 
  validateCoursePayload, 
  validateEmailFormat, 
  validatePasswordStrength 
} from './server/validation';
import { runAllAutomatedTests } from './server/testRunner';
import { Course, User } from './src/types/index';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// API ROUTE HANDLERS

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'CourseReserve API', timestamp: new Date().toISOString() });
});

// AUTHENTICATION ROUTES

// Student Registration
app.post('/api/auth/register', (req, res) => {
  try {
    const { fullName, email, password, confirmPassword, studentIdCode, department, phone } = req.body;

    const validation = validateRegistrationPayload({ fullName, email, password, confirmPassword });
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0], errors: validation.errors });
      return;
    }

    const existing = db.findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email address is already registered.' });
      return;
    }

    const { hash, salt } = hashPassword(password);
    const userId = `usr_std_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const newUser = db.createUser({
      id: userId,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      role: 'student',
      studentIdCode: studentIdCode?.trim() || `CS-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      department: department?.trim() || 'Computer Science',
      phone: phone?.trim(),
      createdAt: new Date().toISOString(),
      passwordHash: hash,
      salt: salt,
    });

    const token = generateToken(newUser);

    db.addAuditLog({
      userId: newUser.id,
      userEmail: newUser.email,
      userRole: newUser.role,
      action: 'USER_REGISTERED',
      entityType: 'user',
      entityId: newUser.id,
      details: `New student registration: ${newUser.fullName} (${newUser.email})`,
    });

    res.status(201).json({
      message: 'Student account registered successfully.',
      user: newUser,
      token,
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error processing registration.' });
  }
});

// User Login (Student or Admin)
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = db.findUserByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials. Please verify your email and password.' });
      return;
    }

    const isValid = verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials. Please verify your email and password.' });
      return;
    }

    const { passwordHash, salt, ...safeUser } = user;
    const token = generateToken(safeUser);

    db.addAuditLog({
      userId: safeUser.id,
      userEmail: safeUser.email,
      userRole: safeUser.role,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: safeUser.id,
      details: `${safeUser.role.toUpperCase()} user logged in: ${safeUser.fullName}`,
    });

    res.json({
      message: 'Login successful.',
      user: safeUser,
      token,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error processing login.' });
  }
});

// Current User Profile
app.get('/api/auth/me', authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

// Update Profile
app.put('/api/auth/profile', authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const { fullName, phone, department, studentIdCode } = req.body;
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const updated = db.updateUser(req.user.id, {
      fullName: fullName ? fullName.trim() : req.user.fullName,
      phone: phone !== undefined ? phone.trim() : req.user.phone,
      department: department !== undefined ? department.trim() : req.user.department,
      studentIdCode: studentIdCode !== undefined ? studentIdCode.trim() : req.user.studentIdCode,
    });

    res.json({ message: 'Profile updated successfully.', user: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// COURSE CATALOGUE ROUTES

// Get Courses (Filtered & Sorted)
app.get('/api/courses', optionalAuth, (req: AuthenticatedRequest, res) => {
  try {
    const { search, category, status, sortBy, sortOrder } = req.query;
    const isAdmin = req.user?.role === 'admin';

    const courses = db.getCourses({
      search: search as string,
      category: category as string,
      status: status as string,
      includeUnpublished: isAdmin, // Admins see all courses; students see only published
      sortBy: sortBy as any,
      sortOrder: sortOrder as any,
    });

    res.json({ courses, total: courses.length });
  } catch (err: any) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: 'Failed to fetch course catalogue.' });
  }
});

// Get Single Course
app.get('/api/courses/:id', optionalAuth, (req: AuthenticatedRequest, res) => {
  try {
    const course = db.getCourseById(req.params.id);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    if (course.status !== 'published' && req.user?.role !== 'admin') {
      res.status(404).json({ error: 'Course is not currently available.' });
      return;
    }

    res.json({ course });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve course details.' });
  }
});

// Create Course (Admin only)
app.post('/api/courses', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const payload = req.body;
    const validation = validateCoursePayload(payload);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0], errors: validation.errors });
      return;
    }

    const courseId = `crs_${Date.now()}`;
    const newCourse: Course = {
      id: courseId,
      code: payload.code.trim().toUpperCase(),
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category.trim(),
      instructor: payload.instructor.trim(),
      instructorTitle: payload.instructorTitle?.trim() || 'Instructor',
      duration: payload.duration?.trim() || '8 Weeks',
      fee: Number(payload.fee),
      startDate: payload.startDate,
      schedule: payload.schedule?.trim() || 'TBA',
      capacity: Number(payload.capacity),
      availableSeats: Number(payload.capacity), // Initially all seats available
      status: payload.status || 'published',
      credits: payload.credits ? Number(payload.credits) : 3,
      prerequisites: Array.isArray(payload.prerequisites) ? payload.prerequisites : [],
      location: payload.location?.trim() || 'Online Lab Classroom',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = db.createCourse(newCourse);

    db.addAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'COURSE_CREATED',
      entityType: 'course',
      entityId: created.id,
      details: `Admin ${req.user!.fullName} created course ${created.code} - ${created.title} with capacity ${created.capacity}.`,
    });

    res.status(201).json({ message: 'Course created successfully.', course: created });
  } catch (err: any) {
    console.error('Create course error:', err);
    res.status(500).json({ error: 'Failed to create course.' });
  }
});

// Update Course (Admin only)
app.put('/api/courses/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const courseId = req.params.id;
    const existing = db.getCourseById(courseId);
    if (!existing) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const updates = req.body;

    // Enforce business rule: new capacity cannot be less than currently occupied seats
    if (updates.capacity !== undefined) {
      const newCapacity = Number(updates.capacity);
      const currentlyBooked = existing.capacity - existing.availableSeats;
      if (newCapacity < currentlyBooked) {
        res.status(400).json({
          error: `Capacity cannot be reduced below the number of currently booked seats (${currentlyBooked}).`,
        });
        return;
      }
      // Adjust available seats proportionally
      const diff = newCapacity - existing.capacity;
      updates.availableSeats = existing.availableSeats + diff;
    }

    const updated = db.updateCourse(courseId, updates);

    db.addAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'COURSE_UPDATED',
      entityType: 'course',
      entityId: courseId,
      details: `Admin ${req.user!.fullName} updated course ${existing.code}.`,
    });

    res.json({ message: 'Course updated successfully.', course: updated });
  } catch (err: any) {
    console.error('Update course error:', err);
    res.status(500).json({ error: 'Failed to update course.' });
  }
});

// Update Course Status (Publish, Unpublish, Archive)
app.patch('/api/courses/:id/status', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const courseId = req.params.id;
    const { status } = req.body;
    if (!['published', 'unpublished', 'archived'].includes(status)) {
      res.status(400).json({ error: 'Invalid status. Must be published, unpublished, or archived.' });
      return;
    }

    const updated = db.updateCourse(courseId, { status });
    if (!updated) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    db.addAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'COURSE_STATUS_CHANGED',
      entityType: 'course',
      entityId: courseId,
      details: `Status of ${updated.code} changed to "${status}".`,
    });

    res.json({ message: `Course status changed to ${status}.`, course: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to change course status.' });
  }
});

// Delete Course (Admin only)
app.delete('/api/courses/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const courseId = req.params.id;
    const existing = db.getCourseById(courseId);
    if (!existing) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    // Check if active reservations exist
    const activeReservations = db.getReservations({ courseId, status: 'active' });
    if (activeReservations.length > 0) {
      res.status(400).json({
        error: `Cannot delete course with ${activeReservations.length} active reservation(s). Archive or cancel reservations first.`,
      });
      return;
    }

    db.deleteCourse(courseId);

    db.addAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'COURSE_DELETED',
      entityType: 'course',
      entityId: courseId,
      details: `Admin ${req.user!.fullName} deleted course ${existing.code} (${existing.title}).`,
    });

    res.json({ message: 'Course deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete course.' });
  }
});

// RESERVATIONS ROUTES

// Get Reservations (Role-protected: Students see only own; Admins see all or filtered)
app.get('/api/reservations', authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const { status, search, courseId, studentId } = req.query;

    if (req.user!.role === 'student') {
      // Students can only see their own reservations
      const reservations = db.getReservations({
        studentId: req.user!.id,
        status: status as string,
        search: search as string,
      });
      res.json({ reservations, total: reservations.length });
      return;
    }

    // Admins can see all reservations or filter by studentId, courseId, status
    const reservations = db.getReservations({
      studentId: studentId as string,
      courseId: courseId as string,
      status: status as string,
      search: search as string,
    });
    res.json({ reservations, total: reservations.length });
  } catch (err: any) {
    console.error('Error fetching reservations:', err);
    res.status(500).json({ error: 'Failed to fetch reservations.' });
  }
});

// Get Single Reservation by ID
app.get('/api/reservations/:id', authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const reservation = db.getReservationById(req.params.id);
    if (!reservation) {
      res.status(404).json({ error: 'Reservation not found.' });
      return;
    }

    if (req.user!.role !== 'admin' && reservation.studentId !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to view this reservation.' });
      return;
    }

    res.json({ reservation });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch reservation details.' });
  }
});

// Create Reservation (Atomic & Transactional)
app.post('/api/reservations', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { courseId, targetStudentId } = req.body;

    if (!courseId) {
      res.status(400).json({ error: 'Course ID is required.' });
      return;
    }

    let targetStudent = req.user!;
    // If admin is booking on behalf of a student
    if (req.user!.role === 'admin' && targetStudentId) {
      const found = db.findUserById(targetStudentId);
      if (!found) {
        res.status(404).json({ error: 'Target student not found.' });
        return;
      }
      const { passwordHash, salt, ...safeUser } = found;
      targetStudent = safeUser;
    }

    const result = await db.reserveSeatAtomically(targetStudent, courseId);
    if (!result.success) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(201).json({
      message: 'Course reservation confirmed successfully!',
      reservation: result.reservation,
    });
  } catch (err: any) {
    console.error('Reservation creation error:', err);
    res.status(500).json({ error: 'Internal server error processing course reservation.' });
  }
});

// Cancel Reservation (Atomic with seat restoration)
app.post('/api/reservations/:id/cancel', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const reservationId = req.params.id;
    const { reason } = req.body;

    const result = await db.cancelReservationAtomically(reservationId, req.user!, reason);
    if (!result.success) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({
      message: 'Reservation cancelled successfully and course seat restored.',
      reservation: result.reservation,
    });
  } catch (err: any) {
    console.error('Cancellation error:', err);
    res.status(500).json({ error: 'Internal server error processing cancellation.' });
  }
});

// Export Reservations as CSV (Admin only)
app.get('/api/reservations/export', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const reservations = db.getReservations();

    const headers = [
      'Confirmation Code',
      'Student Name',
      'Student Email',
      'Course Code',
      'Course Title',
      'Category',
      'Schedule',
      'Course Fee ($)',
      'Status',
      'Reserved At',
      'Cancelled At',
      'Cancellation Reason',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = reservations.map((r) => [
      r.confirmationCode,
      r.studentName || '',
      r.studentEmail || '',
      r.courseCode || '',
      r.courseTitle || '',
      r.courseCategory || '',
      r.courseSchedule || '',
      r.courseFee || 0,
      r.reservationStatus,
      r.reservedAt,
      r.cancelledAt || '',
      r.cancellationReason || '',
    ]);

    const csvContent = [headers.map(escapeCsv).join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="coursereserve-report-${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate CSV report.' });
  }
});

// ADMINISTRATOR STATS & AUDIT LOGS

// Get Admin Dashboard Stats
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const stats = db.getStats();
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to compute administrative statistics.' });
  }
});

// Get Audit Logs
app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const logs = db.getAuditLogs(100);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// SOFTWARE ENGINEERING LAB TESTING MODULE ROUTES

// Get All Lab Test Cases
app.get('/api/tests', (req, res) => {
  try {
    const testCases = db.getTestCases();
    res.json({ testCases });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch lab test cases.' });
  }
});

// Run All Automated Tests
app.post('/api/tests/run-all', async (req, res) => {
  try {
    const summary = await runAllAutomatedTests();
    res.json({
      message: `Executed ${summary.total} automated tests in ${summary.durationMs}ms.`,
      summary,
    });
  } catch (err: any) {
    console.error('Test execution error:', err);
    res.status(500).json({ error: 'Failed to execute test suite.' });
  }
});

// Update Lab Test Case (Status, Notes, AI Review State)
app.put('/api/tests/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const testId = req.params.id;
    const updates = req.body;

    const updated = db.updateTestCase(testId, updates);
    if (!updated) {
      res.status(404).json({ error: 'Test case not found.' });
      return;
    }

    db.addAuditLog({
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'TEST_CASE_UPDATED',
      entityType: 'test',
      entityId: testId,
      details: `Admin ${req.user!.fullName} updated test case ${testId} (Status: ${updated.status}, AI Review: ${updated.aiReviewStatus || 'N/A'}).`,
    });

    res.json({ message: 'Test case updated successfully.', testCase: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update test case.' });
  }
});

// Interactive Concurrency Simulation Endpoint
app.post('/api/tests/simulate-concurrency', async (req, res) => {
  try {
    // Test course with 1 seat
    const testCourseId = `crs_sim_${Date.now()}`;
    const testCourse: Course = {
      id: testCourseId,
      code: 'CONC-99',
      title: 'Real-time Concurrency Stress Test Course',
      description: 'Single seat target for concurrent reservation simulation.',
      category: 'Software Engineering',
      instructor: 'Automated Concurrency Harness',
      duration: '1 Session',
      fee: 100,
      startDate: '2026-12-01',
      schedule: 'TBA',
      capacity: 1,
      availableSeats: 1,
      status: 'published',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.createCourse(testCourse);

    const clientCount = 5;
    const testUsers: User[] = Array.from({ length: clientCount }, (_, i) => ({
      id: `sim_user_${i}_${Date.now()}`,
      fullName: `Concurrent Client #${i + 1}`,
      email: `client${i + 1}_${Date.now()}@college.edu`,
      role: 'student',
      createdAt: new Date().toISOString(),
    }));

    // Trigger simultaneous reservation attempts
    const startMs = Date.now();
    const attempts = await Promise.all(
      testUsers.map((user, idx) =>
        db.reserveSeatAtomically(user, testCourseId).then((r) => ({
          clientId: idx + 1,
          clientName: user.fullName,
          success: r.success,
          status: r.status,
          confirmationCode: r.reservation?.confirmationCode,
          error: r.error,
        }))
      )
    );
    const durationMs = Date.now() - startMs;

    const courseStateAfter = db.getCourseById(testCourseId);
    const successfulAttempts = attempts.filter((a) => a.success);
    const rejectedAttempts = attempts.filter((a) => !a.success);

    // Clean up simulation course
    db.deleteCourse(testCourseId);

    res.json({
      totalThreads: clientCount,
      initialAvailableSeats: 1,
      durationMs,
      successfulCount: successfulAttempts.length,
      rejectedCount: rejectedAttempts.length,
      finalAvailableSeats: courseStateAfter ? courseStateAfter.availableSeats : 0,
      zeroOverbookingConfirmed: successfulAttempts.length === 1 && rejectedAttempts.length === clientCount - 1,
      attempts,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Concurrency simulation failed.' });
  }
});

// Export Test Cases to CSV
app.get('/api/tests/export-csv', (req, res) => {
  try {
    const testCases = db.getTestCases();

    const headers = [
      'Test Case ID',
      'Category',
      'Technique',
      'Objective',
      'Preconditions',
      'Test Inputs',
      'Expected Result',
      'Actual Result',
      'Status',
      'Defect ID',
      'Execution Date',
      'AI Generated',
      'AI Review Status',
      'Notes',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = testCases.map((tc) => [
      tc.id,
      tc.category,
      tc.technique,
      tc.objective,
      tc.preconditions,
      tc.testInputs,
      tc.expectedResult,
      tc.actualResult || '',
      tc.status,
      tc.defectId || '',
      tc.executionDate || '',
      tc.aiGenerated ? 'YES' : 'NO',
      tc.aiReviewStatus || 'N/A',
      tc.notes || '',
    ]);

    const csvContent = [headers.map(escapeCsv).join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="coursereserve-lab-test-cases-${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to export test cases.' });
  }
});

// Reset Database to Fresh Demo Seed
app.post('/api/system/reset-demo', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    db.resetToSeed();
    res.json({ message: 'System database successfully reset to clean demonstration seed data.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reset system database.' });
  }
});

// START SERVER & ATTACH VITE IN DEV MODE
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static frontend build in production
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CourseReserve Server running on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
