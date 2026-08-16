import { globalLocales } from "fullcalendar";
import { Calendar } from "fullcalendar/all";
import "fullcalendar/skeleton.css";
import "fullcalendar/themes/classic/theme.css";
import "fullcalendar/themes/classic/palette.css";

const ptBrLocale = {
  code: "pt-br",
  prevText: "Anterior",
  nextText: "Próximo",
  todayText: "Hoje",
  weekTextLong: "Semana",
  weekTextShort: "Sm",
  dayText: "Dia",
  listText: "Lista",
  allDayText: "Dia inteiro",
  moreLinkText: (count: number) => `mais +${count}`,
  noEventsText: "Não há eventos para mostrar",
};

if (!globalLocales.some((locale) => locale.code === "pt-br")) {
  globalLocales.push(ptBrLocale);
}

declare global {
  interface Window {
    FullCalendar?: {
      Calendar: typeof Calendar;
      globalLocales: typeof globalLocales;
    };
  }
}

window.FullCalendar = { Calendar, globalLocales };
