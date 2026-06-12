import { useEffect, useMemo, useReducer, useState } from "react";
import { createBus } from "./lib/bus";
import { initialState, reduce } from "./lib/store";
import { OnAirHeader, Ticker } from "./components/OnAirHeader";
import { Switchboard } from "./components/Switchboard";
import { HoldQueue } from "./components/HoldQueue";
import { FeedPanel } from "./components/FeedPanel";
import { StreamPlayer } from "./components/StreamPlayer";
import { SideNav, type View } from "./components/SideNav";
import {
  AdvertisePage,
  CallbackStrip,
  CallInPage,
  JoinStrip,
  PodcastsPage,
  ShowsPage,
} from "./components/Pages";
import { Footer } from "./components/Footer";

export default function App() {
  const bus = useMemo(() => createBus(), []);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [view, setView] = useState<View>("live");

  useEffect(() => {
    const unsub = bus.subscribe(dispatch);
    bus.start();
    return () => {
      unsub();
      bus.stop();
    };
  }, [bus]);

  return (
    <div className="crt flex min-h-full flex-col">
      <div className="noise" />
      <OnAirHeader state={state} />
      <Ticker segment={state.segment} text={state.ticker} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SideNav view={view} onNavigate={setView} />
        <div className="min-w-0 flex-1">
          {view === "live" && (
            <main className="mx-auto grid w-full max-w-375 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
              <section className="min-w-0">
                <Switchboard state={state} />
                <HoldQueue state={state} />
              </section>
              <aside className="flex min-h-105 flex-col gap-3 lg:max-h-[calc(100vh-180px)]">
                <StreamPlayer nowPlaying={state.nowPlaying} />
                <CallbackStrip />
                <JoinStrip onNavigate={setView} />
                <div className="min-h-0 flex-1">
                  <FeedPanel state={state} onBrowseTape={() => setView("podcasts")} />
                </div>
              </aside>
            </main>
          )}
          {view === "shows" && <ShowsPage state={state} />}
          {view === "podcasts" && <PodcastsPage />}
          {view === "callin" && <CallInPage />}
          {view === "advertise" && <AdvertisePage />}
        </div>
      </div>
      <Footer />
    </div>
  );
}
