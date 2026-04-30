type Preview = {
  login: string | null;
  password: string | null;
  updatedAt: string;
};

const previews = new Map<number, Preview>();

export function setAdminCredentialPreview(adminId: number, preview: Preview): void {
  previews.set(adminId, preview);
}

export function getAdminCredentialPreview(adminId: number): Preview | null {
  return previews.get(adminId) ?? null;
}
