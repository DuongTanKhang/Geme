FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .
RUN dotnet restore Aegis.API/Aegis.API.csproj
RUN dotnet publish Aegis.API/Aegis.API.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:5130
EXPOSE 5130
ENTRYPOINT ["dotnet", "Aegis.API.dll"]
