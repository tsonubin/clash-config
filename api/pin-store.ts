import fs from "fs";
import path from "path";

import { secretEqual } from "./secret-equal.js";

const PIN_PATTERN = /^[A-Za-z0-9]{4,64}$/;

export function defaultPinFile(): string {
	const configured = process.env.PIN_FILE?.trim();
	if (configured) return configured;
	return path.join(process.cwd(), "data", "pin.txt");
}

export function validatePin(pin: string): string | null {
	if (!PIN_PATTERN.test(pin)) return "PIN must be 4–64 letters or digits";
	return null;
}

// The file wins over PORTAL_PIN so an administrator change sticks. PORTAL_PIN
// is only the initial value used before the file exists.
export function readConfiguredPin(file = defaultPinFile()): string | null {
	let pin = "";
	if (fs.existsSync(file)) {
		pin = fs.readFileSync(file, "utf8").replace(/[\r\n]+$/g, "");
	} else {
		pin = process.env.PORTAL_PIN?.trim() ?? "";
	}
	if (!pin || validatePin(pin)) return null;
	return pin;
}

export function pinMatches(attempt: string, file = defaultPinFile()): boolean {
	const stored = readConfiguredPin(file);
	if (!stored) return false;
	return secretEqual(stored, attempt);
}

export function writePin(pin: string, file = defaultPinFile()): void {
	const problem = validatePin(pin);
	if (problem) throw new Error(problem);

	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });
	try {
		fs.chmodSync(dir, 0o700);
	} catch {
		// Some filesystems reject chmod. The write below is the part that matters.
	}

	const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
	fs.writeFileSync(tmp, `${pin}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	try {
		fs.chmodSync(file, 0o600);
	} catch {
		// Ignore chmod failures on platforms that do not allow it.
	}
}
