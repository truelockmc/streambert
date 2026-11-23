/** A shared editorial welcome, used by both the desktop app and the preview. */
export default function BrandMasthead({ onExplore }) {
  return (
    <section className="brand-masthead" aria-label="Welcome to Frame">
      <div className="brand-masthead-copy">
        <div className="brand-masthead-label"><span /> YOUR PERSONAL SCREENING ROOM</div>
        <h1>Make room<br />for <em>wonder.</em></h1>
        <p>For the stories that stay with you. Find something extraordinary to watch tonight.</p>
        <button className="brand-masthead-button" type="button" onClick={onExplore}>Find a story <span>↗</span></button>
      </div>
      <div className="brand-masthead-side" aria-hidden="true"><span>FRAME</span><i /> <span>THE ART OF WATCHING</span></div>
      <div className="brand-masthead-bottom" aria-hidden="true"><span>AN OPENING TO ANOTHER WORLD</span><span>✳ &nbsp; EST. FOR THE CURIOUS</span></div>
    </section>
  );
}
