import mongoose, { Schema, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], required: true, default: "user" },
  },
  { timestamps: true },
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export const User = mongoose.model("User", userSchema);
