FROM opensearchproject/opensearch-dashboards:3.9.0
COPY --chown=opensearch-dashboards:opensearch-dashboards build/clusterExplorer-3.9.0.zip /tmp/clusterExplorer.zip
RUN /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin install file:///tmp/clusterExplorer.zip && rm /tmp/clusterExplorer.zip
