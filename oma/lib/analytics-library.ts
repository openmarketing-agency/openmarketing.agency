/** Selects the OpenUI dashboard components used by generated workspace reports. */

import { library } from "@openuidev/dashboard-library";
import { createLibrary } from "@openuidev/react-lang";

const components = library.components;
export const analyticsLibrary = createLibrary({
  root: "Dashboard",
  components: [
    components.Dashboard, components.FilterBar, components.SelectFilter,
    components.Section, components.Row, components.Card,
    components.Kpis, components.Kpi, components.Stat,
    components.Bars, components.TimeSeries, components.Series,
    components.Table, components.Column,
  ],
});
