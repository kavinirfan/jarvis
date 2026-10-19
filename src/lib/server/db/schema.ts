import { boolean, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

/** Session id is the SHA-256 of the cookie token, so a database leak can't be replayed as a login. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const settings = pgTable("settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  summary: text("summary").notNull().default(""),
  /** Embedding of the summary, for recalling past conversations by meaning. */
  summaryEmbedding: jsonb("summary_embedding").$type<number[] | null>(),
  /** How many messages the current summary covers. */
  summarizedCount: integer("summarized_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)]);

/**
 * role: "user" (asked JARVIS), "assistant" (JARVIS's answer), "transcript" (ambient speech JARVIS
 * heard while listening; only stored when transcript retention is enabled).
 */
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  meta: jsonb("meta").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt), index("messages_user_idx").on(t.userId, t.createdAt)]);

/**
 * kind: fact | preference | project | inference. status: proposed (awaiting the user's approval)
 * or approved. Only approved memories are ever given to the model.
 */
export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("proposed"),
  source: text("source").notNull().default("user"),
  confidence: real("confidence").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Semantic vector (256-d) for recall by meaning. */
  embedding: jsonb("embedding").$type<number[] | null>(),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [index("memories_user_idx").on(t.userId, t.status)]);

/**
 * What JARVIS has learned about working with the user, produced by periodic reflection over
 * feedback, conversations and memories. kind: "behavior" (how to act) or "profile" (who the user is).
 * Only active rows are used; every reflection replaces the previous set (old rows kept for history).
 */
export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  active: boolean("active").notNull().default(true),
  generation: integer("generation").notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index("insights_user_idx").on(t.userId, t.active)]);

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("feedback_message_user_idx").on(t.messageId, t.userId)]);

/** Approved examples used to evaluate prompt/model configurations. */
export const evalCases = pgTable("eval_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  expectedPoints: jsonb("expected_points").notNull().default([]).$type<string[]>(),
  expectResearch: boolean("expect_research").notNull().default(false),
  approved: boolean("approved").notNull().default(false),
  createdAt: createdAt(),
});

/** Versioned prompt + model configuration. Exactly one row is "active". */
export const promptConfigs = pgTable("prompt_configs", {
  id: serial("id").primaryKey(),
  version: text("version").notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().default("candidate"),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
}, (t) => [uniqueIndex("prompt_configs_version_idx").on(t.version)]);

export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  configVersion: text("config_version").notNull(),
  scores: jsonb("scores").notNull().$type<Record<string, number>>(),
  results: jsonb("results").notNull().$type<unknown[]>(),
  createdAt: createdAt(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: createdAt(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  due: text("due"),
  createdAt: createdAt(),
});

/** Tool actions that need the user's confirmation before they run. */
export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  args: jsonb("args").notNull().$type<Record<string, unknown>>(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  risk: text("risk").notNull().default("low"),
  status: text("status").notNull(),
  detail: jsonb("detail").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("audit_user_idx").on(t.userId, t.createdAt)]);

/** Usage and failure telemetry: kind = llm | search | tts | stt | search_failure | error. */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  provider: text("provider").notNull().default(""),
  units: integer("units").notNull().default(1),
  latencyMs: integer("latency_ms"),
  detail: jsonb("detail").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("usage_user_idx").on(t.userId, t.createdAt), index("usage_kind_idx").on(t.kind, t.createdAt)]);
