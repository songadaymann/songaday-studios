import { songADayNumber } from './song-day.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.songaday.studio' || url.protocol === 'http:') {
      if (url.hostname === 'www.songaday.studio') url.hostname = 'songaday.studio';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const response = await env.ASSETS.fetch(request);
    if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

    const number = songADayNumber();
    const page = new HTMLRewriter()
      .on('[data-song-day="today"]', {
        element(element) { element.setInnerContent(String(number)); }
      })
      .on('[data-song-day="tomorrow"]', {
        element(element) { element.setInnerContent(String(number + 1)); }
      })
      .transform(response);
    page.headers.set('Cache-Control', 'no-cache');
    page.headers.delete('ETag');
    page.headers.delete('Last-Modified');
    return page;
  }
};
