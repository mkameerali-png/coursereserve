export type Course = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  instructor: string;
  fee: number;
  capacity: number;
  availableSeats: number;
  status: 'published' | 'unpublished' | 'archived';
  createdAt?: string;
  updatedAt?: string;
};

export type User = {
  id: string;
  fullName: string;
  email: string;
  role: 'student' | 'admin';
  createdAt?: string;
  passwordHash?: string;
  salt?: string;
};

export type Reservation = {
  id: string;
  courseId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseCode: string;
  courseTitle: string;
  courseCategory: string;
  courseSchedule: string;
  courseFee: number;
  confirmationCode: string;
  reservationStatus: 'active' | 'cancelled';
  reservedAt: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
};

export type AuditLog = {
  id: string;
  userId: string;
  userEmail: string;
  userRole: 'student' | 'admin';
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
};

export type TestCase = {
  id: string;
  category: string;
  technique: string;
  objective: string;
  preconditions: string;
  testInputs: string;
  expectedResult: string;
  actualResult?: string;
  status: 'pass' | 'fail' | 'pending';
  defectId?: string;
  executionDate?: string;
  aiGenerated?: boolean;
  aiReviewStatus?: 'accepted' | 'rejected' | 'needs_revision';
  notes?: string;
};
