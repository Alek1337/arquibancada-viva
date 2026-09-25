import { ConnectedArena } from "../components/connected-arena";

const foundations = [
  {
    index: "01",
    label: "Placar autoritativo",
    text: "O servidor continua sendo a única fonte de verdade.",
  },
  {
    index: "02",
    label: "Ao vivo de verdade",
    text: "Eventos ordenados e lacunas recuperadas por snapshot.",
  },
  {
    index: "03",
    label: "Competição humana",
    text: "Organização e presença sem venda direta de poder.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#arena">
        Pular para a partida
      </a>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Arquibancada Viva — início">
          <span className="brand__mark" aria-hidden="true">
            AV
          </span>
          <span>Arquibancada Viva</span>
        </a>
        <nav aria-label="Navegação principal">
          <a href="#manifesto">Manifesto</a>
          <a href="#arena">Partida</a>
        </nav>
        <span className="beta-tag">Beta técnico</span>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="eyebrow">
              <span aria-hidden="true">●</span> Sua torcida. Sua presença.
            </p>
            <h1 id="hero-title">
              Faça a arquibancada <em>pulsar.</em>
            </h1>
            <p className="lede">
              Uma disputa social em tempo real, criada para quem transforma coordenação, ritmo e
              paixão em vantagem coletiva.
            </p>
            <div className="hero__actions">
              <a className="primary-button" href="#arena">
                Abrir central técnica
              </a>
              <a className="text-link" href="#manifesto">
                Entender a fundação <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div
            className="hero__signal"
            aria-label="Ilustração abstrata de uma arquibancada"
            role="img"
          >
            <span className="signal-ring signal-ring--outer" />
            <span className="signal-ring signal-ring--middle" />
            <span className="signal-ring signal-ring--inner" />
            <span className="signal-core">AV</span>
            <span className="signal-caption">20 vozes • 1 ritmo</span>
          </div>
        </section>

        <section className="manifesto" id="manifesto" aria-labelledby="manifesto-title">
          <div className="manifesto__intro">
            <p className="section-kicker">Fundação do beta</p>
            <h2 id="manifesto-title">Intensidade sem perder a confiança.</h2>
          </div>
          <div className="foundation-grid">
            {foundations.map((foundation) => (
              <article key={foundation.index}>
                <span className="foundation-index" aria-hidden="true">
                  {foundation.index}
                </span>
                <h3>{foundation.label}</h3>
                <p>{foundation.text}</p>
              </article>
            ))}
          </div>
        </section>

        <ConnectedArena />
      </main>

      <footer>
        <span>Arquibancada Viva</span>
        <span>Experiência fictícia e independente • 18+</span>
      </footer>
    </>
  );
}
