import NewSourceForm from "./NewSourceForm";

export default function NewSourcePage() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Register a source</h1>
        <p>
          The source is the authority, standards body, or organisation that
          published the documents you'll ingest (e.g. AESIA, ENISA, CNIL).
        </p>
      </header>
      <NewSourceForm />
    </main>
  );
}
