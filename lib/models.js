import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: { type: [String], validate: value => value.length >= 2 && value.length <= 6 },
  correctAnswer: { type: String, required: true },
  explanation: String,
  sourcePage: Number,
  confidence: Number,
  needsReview: Boolean,
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
}, { timestamps: true });

const testSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  originalPdfName: String,
  expectedBytes: { type: Number, min: 1 },
  chunkCount: { type: Number, min: 1 },
  questions: [questionSchema],
  duration: { type: Number, min: 1, max: 240, default: 30 },
  totalMarks: { type: Number, default: 0 },
  status: { type: String, enum: ['uploading', 'uploaded', 'processing', 'ready', 'failed'], default: 'uploading' },
  processingError: String,
}, { timestamps: true });

const chunkSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  index: { type: Number, required: true, min: 0 },
  data: { type: Buffer, required: true },
}, { timestamps: true });
chunkSchema.index({ testId: 1, index: 1 }, { unique: true });

const attemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
  answers: { type: Map, of: String, default: {} },
  visited: { type: [Number], default: [] },
  startedAt: Date,
  expiresAt: Date,
  submittedAt: Date,
  score: Number,
  correctCount: Number,
  incorrectCount: Number,
  unattemptedCount: Number,
  accuracy: Number,
  timeTaken: Number,
  status: { type: String, enum: ['in_progress', 'submitted', 'expired'], default: 'in_progress' },
}, { timestamps: true });

const rateLimitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Test = mongoose.models.Test || mongoose.model('Test', testSchema);
export const UploadChunk = mongoose.models.UploadChunk || mongoose.model('UploadChunk', chunkSchema);
export const Attempt = mongoose.models.Attempt || mongoose.model('Attempt', attemptSchema);
export const RateLimit = mongoose.models.RateLimit || mongoose.model('RateLimit', rateLimitSchema);
