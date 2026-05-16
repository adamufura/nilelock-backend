import mongoose, { Schema, type InferSchemaType } from "mongoose";

const lockSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug format"],
    },
    name: { type: String, required: true, trim: true },
    location: { type: String, trim: true, default: "" },
    owners: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: [(v: unknown[]) => Array.isArray(v) && v.length > 0, "At least one owner required"],
    },
    state: { type: String, enum: ["locked", "unlocked"], required: true, default: "locked" },
    batteryLevel: { type: Number, min: 0, max: 100, default: 100 },
  },
  { timestamps: true },
);

lockSchema.index({ owners: 1 });

export type LockDocument = InferSchemaType<typeof lockSchema> & { _id: mongoose.Types.ObjectId };
export const Lock = mongoose.model("Lock", lockSchema);
