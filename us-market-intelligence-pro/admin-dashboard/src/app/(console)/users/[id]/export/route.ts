import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { hasRole } from "@/lib/roles";

/** Data-subject access export, streamed as a JSON download (admin only; enforced again by the API). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasRole(session.role, "admin")) return new NextResponse("forbidden", { status: 403 });
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new NextResponse("not found", { status: 404 });
  try {
    const data = await api<unknown>(`/admin/users/${id}/export`);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="user-${id}-data.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return new NextResponse("export failed", { status });
  }
}
