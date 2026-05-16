import mongoose, { Schema, type InferSchemaType } from "mongoose";

const passcodeSchema = new Schema(
  {
    lock: { type: Schema.Types.ObjectId, ref: "Lock", required: true, index: true },
    /** Optional legacy shared code; prefer per-user keys. */
    forUser: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    hash: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

passcodeSchema.index({ lock: 1, active: 1 });
passcodeSchema.index({ lock: 1, forUser: 1, active: 1 });

export type PasscodeDocument = InferSchemaType<typeof passcodeSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const Passcode = mongoose.model("Passcode", passcodeSchema);
