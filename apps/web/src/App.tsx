export function App() {
  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>Magic CRM</h1>
        </div>
      </header>

      <section className="intro" aria-labelledby="demo-heading">
        <h2 id="demo-heading">A CRM that designs its own schema</h2>
        <p>
          Paste an email and Magic CRM will identify the record type, evolve a logical schema,
          preserve source evidence, and answer questions about the result. Ingestion arrives in a
          future milestone.
        </p>
      </section>

      <section className="panels" aria-label="Email input">
        <article>
          <label className="visually-hidden" htmlFor="email-body">
            Email body
          </label>
          <textarea
            id="email-body"
            name="email-body"
            placeholder="Paste a lead, support ticket, or any other business email…"
          />
        </article>
      </section>
    </main>
  );
}
