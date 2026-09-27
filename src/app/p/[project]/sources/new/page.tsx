import NewSourceForm from "./NewSourceForm";

export default async function NewSourcePage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  return (
    <main className="page">
      <header className="page-header">
        <h1>Register a source</h1>
        <p>
          The source is the authority, standards body, or organisation that
          published the documents you'll reference (e.g. AESIA, ENISA, CNIL).
        </p>
      </header>
      <NewSourceForm project={project} />
    </main>
  );
}
