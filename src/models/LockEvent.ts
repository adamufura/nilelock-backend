import mongoose, { Schema, type InferSchemaType } from "mongoose";

const lockEventSchema = new Schema(
  {
    lock: { type: Schema.Types.ObjectId, ref: "Lock", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: ["lock", "unlock"], required: true },
    outcome: { type: String, enum: ["success", "denied", "error"], required: true },
    channel: {
      type: String,
      enum: ["mobile", "dashboard", "simulator", "api"],
      required: true,
      default: "api",
    },
    detail: { type: String, default: "" },
  },
  { timestamps: true },
);

lockEventSchema.index({ createdAt: -1 });
lockEventSchema.index({ lock: 1, createdAt: -1 });

export type LockEventDocument = InferSchemaType<typeof lockEventSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const LockEvent = mongoose.model("LockEvent", lockEventSchema);
