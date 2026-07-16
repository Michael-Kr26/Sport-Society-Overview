async function requestJson(url, options = {}) {
    let response;

    try {
        response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
    } catch (error) {
        const networkError = new Error(
            'De server is niet bereikbaar. Start de applicatie met npm start en open http://localhost:3000/hours.html.'
        );
        networkError.status = 0;
        throw networkError;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};

    if (!response.ok) {
        let fallbackMessage = 'De aanvraag is mislukt.';

        if (response.status === 404 && String(url).startsWith('/api/hours/')) {
            fallbackMessage = [
                'De uren-API is niet actief.',
                'Stop de huidige server, start opnieuw met npm start en open de pagina via http://localhost:3000/hours.html.'
            ].join(' ');
        }

        const error = new Error(payload.message || fallbackMessage);
        error.status = response.status;
        throw error;
    }

    return payload;
}
