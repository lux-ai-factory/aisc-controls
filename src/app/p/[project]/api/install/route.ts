/**
 * The catalogue's Install button posts here, under the project the control goes into: the gateway binds
 * the request to this project, so the control.installed event is recorded in its ledger. A form that
 * names another project than this address is refused before anything is installed.
 */
import { installForCaller } from "@/lib/installControl";
import { allowedOrigin, reply } from "@/lib/installApi";
import { emitEvent } from "@/vendor/aisc-ledger/emit";
import { installedEvent } from "@/lib/ledger/install";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ project: string }> }): Promise<Response> {
  const { ok, origin } = allowedOrigin(request);
  if (!ok) return reply({ error: "Only the catalogue may install." }, 403, null);
  const { project } = await params;
  const form = await request.formData();
  const named = form.get("project");
  if (named !== null && String(named) !== project) {
    return reply({ error: "The install names another project than the address it was sent to. Nothing was installed." },
      409, origin);
  }
  const result = await installForCaller(project, String(form.get("slug") ?? "").trim(),
    (tx, installed) => emitEvent(tx, { action: "control.installed", ...installedEvent(installed) }));
  if (!result.ok) return reply({ error: result.error }, result.status, origin);
  const { ok: _ok, ...installed } = result;
  return reply(installed, 200, origin);
}
