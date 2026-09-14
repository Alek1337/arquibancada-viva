const foundations = [
  "Placar autoritativo ao vivo",
  "Quatro ações de arquibancada",
  "Progressão com especialidades",
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">Fundação técnica do beta</p>
        <h1 id="hero-title">Arquibancada Viva</h1>
        <p className="lede">
          Uma disputa social em tempo real movida por presença, organização e paixão de
          arquibancada.
        </p>
        <ul aria-label="Pilares do jogo">
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>
        <p className="status" role="status">
          Shell operacional — as rotas de produto chegam nas próximas etapas.
        </p>
      </section>
    </main>
  );
}
