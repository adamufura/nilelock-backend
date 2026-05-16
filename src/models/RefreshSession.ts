import mongoose, { Schema, type InferSchemaType } from "mongoose";

const refreshSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSessionDocument = InferSchemaType<typeof refreshSessionSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const RefreshSession = mongoose.model("RefreshSession", refreshSessionSchema);
