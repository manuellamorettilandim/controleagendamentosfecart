import React, { useState } from "react";
import { GuideCard } from "./GuideCard";
import { GuideReader } from "./GuideReader";
import type { GuideId } from "./guideConfig";

export interface GuidesViewProps {
  theme: "light" | "dark";
}

export function GuidesView({ theme }: GuidesViewProps) {
  const [selectedGuide, setSelectedGuide] = useState<GuideId | null>(null);
  const heroIllustration = "/assets/illustrations/" + theme + "/guides_hero_" + theme + ".png";
  const recommendedIllustration = "/assets/illustrations/" + theme + "/guide_card_chatgpt_cursor_" + theme + ".png";

  if (selectedGuide) {
    return <GuideReader guide={selectedGuide} onBack={() => setSelectedGuide(null)} />;
  }

  return (
    <div className="guides-view-shell">
      <section className="guides-index-hero">
        <div className="guides-index-hero-copy">
          <span className="kicker-tag">APRENDA EM POUCOS MINUTOS</span>
          <h1>Guias de acesso</h1>
          <p>A configuração inicial conecta o Codex ao FECART. Escolha o caminho mais rápido ou siga as etapas manualmente.</p>
        </div>
        <div className="guides-index-hero-art">
          <img src={heroIllustration} alt="" loading="lazy" />
        </div>
      </section>

      <section className="guides-index-section" aria-labelledby="guides-index-title">
        <div className="guides-index-heading">
          <div>
            <span className="kicker-tag">ESCOLHA COMO CONFIGURAR</span>
            <h2 id="guides-index-title">Dois caminhos, o mesmo resultado</h2>
          </div>
          <p>Os dois guias fazem a mesma configuração e preservam seu arquivo original.</p>
        </div>

        <div className="guides-index-grid">
          <GuideCard
            icon="ph-lightning"
            iconBgColor="rgba(16, 185, 129, 0.12)"
            iconColor="var(--color-success)"
            badgeText="RECOMENDADO"
            title="Guia rápido"
            description="Faça a configuração inicial em poucos passos. O comando conecta o Codex ao FECART, cria um backup e permite restaurar tudo depois."
            features={["Configuração automática", "Windows, macOS e Linux", "Backup e restauração"]}
            illustrationSrc={recommendedIllustration}
            buttonLabel="Abrir guia rápido"
            isPrimaryButton={true}
            onOpen={() => setSelectedGuide("quick")}
          />

          <GuideCard
            icon="ph-book-open"
            iconBgColor="rgba(var(--color-brand-primary-rgb), 0.1)"
            iconColor="var(--color-brand-primary)"
            title="Manual passo a passo"
            description="Faça a mesma configuração sem comandos prontos: encontre o config.toml, salve o arquivo e conecte o Codex ao FECART."
            features={["Encontre o config.toml", "Backup do arquivo original", "CLI e App"]}
            buttonLabel="Abrir manual"
            isPrimaryButton={false}
            onOpen={() => setSelectedGuide("manual")}
          />
        </div>
      </section>
    </div>
  );
}
