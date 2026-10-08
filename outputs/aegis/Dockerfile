FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY . .
RUN dotnet restore Aegis.API/Aegis.API.csproj
RUN dotnet publish Aegis.API/Aegis.API.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:5130
EXPOSE 5130
ENTRYPOINT ["dotnet", "Aegis.API.dll"]
